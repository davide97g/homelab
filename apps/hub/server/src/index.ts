import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { readFile, stat } from "node:fs/promises";
import { dirname, extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { tail, writable } from "./actions/audit.js";
import { dispatch } from "./actions/dispatch.js";
import { catalog as actionCatalog } from "./actions/registry.js";
import { checkPassword, cookieHeader, issue, readCookie, verify } from "./auth.js";
import { containers } from "./collect/containers.js";
import { nasDetail } from "./collect/nas.js";
import { summary } from "./collect/summary.js";
import { topology } from "./collect/topology.js";
import { config } from "./config.js";
import { logOptions, logs, parseLogRequest } from "./loki/query.js";
import { catalog, frames, parseRequest, rangeSeconds, series } from "./prom/series.js";
import { clientIp, forgive, limited } from "./limiter.js";

const here = dirname(fileURLToPath(import.meta.url));
// dist/index.js sits next to the built frontend, which the Dockerfile copies in.
const staticRoot = join(here, "public");

if (!config.password) {
  console.error("HUB_PASSWORD is not set — refusing to start an unprotected hub.");
  process.exit(1);
}
if (!config.sessionSecret) {
  console.warn("SESSION_SECRET is not set — a random one was generated, so a restart logs you out.");
}

const app = new Hono();

const LOGIN_WINDOW_MS = 5 * 60_000;
const LOGIN_MAX = 10;

app.post("/api/login", async (c) => {
  const ip = clientIp((k) => c.req.header(k));
  if (limited(`login:${ip}`, LOGIN_MAX, LOGIN_WINDOW_MS)) {
    return c.json({ error: "too many attempts, wait a few minutes" }, 429);
  }

  const body = await c.req.json<{ password?: string }>().catch(() => ({}) as { password?: string });
  if (!checkPassword(body.password ?? "")) return c.json({ error: "wrong password" }, 401);

  forgive(`login:${ip}`);
  c.header("Set-Cookie", cookieHeader(issue()));
  return c.json({ ok: true });
});

app.post("/api/logout", (c) => {
  c.header("Set-Cookie", cookieHeader(null));
  return c.json({ ok: true });
});

app.get("/api/session", (c) =>
  c.json({ authenticated: verify(readCookie(c.req.header("cookie"))) }),
);

/** One guard over the whole prefix, not one per route.
 *
 *  mediarr-dash guards its single data path individually, which is fine for one
 *  route and a standing invitation to forget the eleventh. The three routes
 *  above are registered before this and so stay open by construction. */
app.use("/api/*", async (c, next) => {
  if (!verify(readCookie(c.req.header("cookie")))) return c.json({ error: "unauthorized" }, 401);
  await next();
});

app.get("/api/summary", async (c) => {
  const data = await summary();
  // Every number here is seconds old by design; never let a proxy or the browser
  // serve an older one on top of that.
  c.header("Cache-Control", "no-store");
  return c.json(data);
});

/** The estate as a graph: both flats, every device, and the paths between them.
 *
 *  Built on top of /api/summary rather than beside it, so the landing page and
 *  the machine pages cannot disagree about whether the NAS is up. What it adds
 *  is the part no other endpoint knows: which paths exist, which of them
 *  anything actually measures, and which one is only inferred. */
app.get("/api/topology", async (c) => {
  const data = await topology();
  c.header("Cache-Control", "no-store");
  return c.json(data);
});

/** The NAS in full: pool, arrays, bays, sensors and its containers. Separate
 *  from /api/summary because only one page needs it and it is the one machine
 *  whose answers arrive over a relayed tailnet hop. */
app.get("/api/nas", async (c) => {
  const data = await nasDetail();
  c.header("Cache-Control", "no-store");
  return c.json(data);
});

/** Everything a page needs to lay itself out: ids, titles, units and which
 *  machine each applies to. Static, so it is cached hard. */
app.get("/api/catalog", (c) => {
  c.header("Cache-Control", "no-store");
  return c.json(catalog());
});

/** Time series by id. Never by PromQL — see server/src/prom/registry.ts for why,
 *  and note that everything the browser sends is parsed and clamped before any
 *  expression is rendered. */
app.get("/api/series", async (c) => {
  const parsed = parseRequest(new URL(c.req.url).searchParams);
  if ("error" in parsed) return c.json({ error: parsed.error }, 400);
  const data = await series(parsed);
  c.header("Cache-Control", "no-store");
  return c.json(data);
});

/** The same frames, but streamed one at a time as each finishes.
 *
 *  The batched route above answers in as long as its slowest panel takes, and on
 *  a cold cache that is the whole point of the wait: six charts held hostage by
 *  one query crossing the tunnel to a NAS that is scraped once a minute. The
 *  work was already running in parallel; this hands each result over the moment
 *  it exists, so a page fills in instead of arriving all at once or not at all.
 *
 *  Only the first load of a given window uses this. Once the panels are on
 *  screen the page goes back to the batched route, where the server cache means
 *  the whole reply is one fast round trip. */
app.get("/api/series/stream", (c) => {
  const parsed = parseRequest(new URL(c.req.url).searchParams);
  if ("error" in parsed) return c.json({ error: parsed.error }, 400);

  // A proxy that buffers would defeat the entire point of this route.
  c.header("X-Accel-Buffering", "no");

  return streamSSE(
    c,
    async (stream) => {
      const pending = frames(parsed);
      // Sent before any query resolves, so the page knows what it is waiting for
      // and can draw the right number of panels rather than a guess.
      await stream.writeSSE({
        event: "open",
        data: JSON.stringify({ ids: parsed.ids, instance: parsed.instance, range: parsed.range }),
      });

      let stepS = 0;
      await Promise.all(
        pending.map(async (p, i) => {
          const frame = await p;
          stepS = Math.max(stepS, frame.stepS);
          // Safe to race: writeSSE encodes one event and writes it as a single
          // chunk, so two landing in the same tick cannot interleave.
          await stream.writeSSE({ event: "frame", data: JSON.stringify(frame), id: String(i) });
        }),
      );

      await stream.writeSSE({
        event: "done",
        data: JSON.stringify({ at: new Date().toISOString(), rangeS: rangeSeconds(parsed.range), stepS }),
      });
    },
    async (err) => {
      // Hono follows this with its own `error` event carrying the message, which
      // the page shows. Without an onError it would swallow the failure whole.
      console.error("series stream failed:", err.message);
    },
  );
});

/** Every container on both machines. Docker's list for the mini PC -- which is
 *  the only way a *stopped* container is visible at all -- and cAdvisor's
 *  numbers on top of it. See server/src/collect/containers.ts. */
app.get("/api/containers", async (c) => {
  c.header("Cache-Control", "no-store");
  return c.json(await containers());
});

/** The live label sets behind the log filters. Cached 60 s upstream, so this is
 *  cheap enough for the page to refresh it whenever it likes. */
app.get("/api/logs/options", async (c) => {
  c.header("Cache-Control", "no-store");
  return c.json(await logOptions());
});

/** Structured filters in, LogQL assembled here — never a query from the
 *  browser. A stream selector is mandatory in LogQL but `{job=~".+"}` is a legal
 *  one, and over 30 days of retention that is every line the stack has written.
 *  See server/src/loki/query.ts. */
app.get("/api/logs", async (c) => {
  const parsed = await parseLogRequest(new URL(c.req.url).searchParams);
  if ("error" in parsed) return c.json({ error: parsed.error }, 400);
  try {
    const data = await logs(parsed);
    c.header("Cache-Control", "no-store");
    return c.json(data);
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 502);
  }
});

/** What the hub can change, and what it cannot change yet and why. Availability
 *  is computed from what is actually configured on the box, so an action whose
 *  credential has never been collected says so instead of failing at the click. */
app.get("/api/actions", (c) => {
  c.header("Cache-Control", "no-store");
  return c.json({ actions: actionCatalog() });
});

/** The only write path in the hub. One dispatcher rather than a route per
 *  action, so throttle, confirmation, idempotency, audit and error shaping exist
 *  once -- see server/src/actions/dispatch.ts. */
app.post("/api/actions", async (c) => {
  const body = await c.req
    .json<Record<string, unknown>>()
    .catch(() => ({}) as Record<string, unknown>);
  const result = await dispatch({
    action: body.action,
    target: body.target,
    key: body.key,
    confirm: body.confirm,
    from: clientIp((k) => c.req.header(k)),
  });
  c.header("Cache-Control", "no-store");
  // Always 200: the outcome is in the payload. A refusal is a normal answer that
  // the page renders, not a transport failure, and shaping it as a status code
  // would make "denied" and "the tunnel dropped" indistinguishable in the client.
  return c.json(result);
});

/** The audit, newest first. Read-only and unfiltered: an audit with a filter in
 *  front of it is a report. */
app.get("/api/actions/log", async (c) => {
  c.header("Cache-Control", "no-store");
  const [entries, ok] = await Promise.all([tail(200), writable()]);
  return c.json({ entries, path: config.auditPath, writable: ok });
});

/** Unauthenticated, because it is the container healthcheck's target. It says
 *  nothing about the box. Note that Cloudflare Access gates this too, so an
 *  external uptime probe needs its own Bypass policy scoped to this path. */
app.get("/healthz", (c) => c.text("ok"));

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

/** Serve the built frontend, and fall back to index.html for anything that is
 *  not a real file -- every client route is the same shell. Login state lives in
 *  a cookie the client checks, so handing the shell to a stranger reveals
 *  nothing; the data routes above are what is guarded. */
app.get("*", async (c) => {
  const requested = decodeURIComponent(new URL(c.req.url).pathname);
  const candidate = resolve(staticRoot, `.${normalize(requested)}`);
  const inRoot = candidate === staticRoot || candidate.startsWith(staticRoot + sep);

  if (inRoot && requested !== "/") {
    try {
      if ((await stat(candidate)).isFile()) {
        const type = MIME[extname(candidate)] ?? "application/octet-stream";
        // Vite fingerprints everything under /assets, so those are immutable.
        const immutable = requested.startsWith("/assets/");
        c.header("Content-Type", type);
        c.header("Cache-Control", immutable ? "public, max-age=31536000, immutable" : "no-cache");
        return c.body(await readFile(candidate));
      }
    } catch {
      // fall through to the shell
    }
  }

  try {
    c.header("Cache-Control", "no-cache");
    return c.html(await readFile(join(staticRoot, "index.html"), "utf8"));
  } catch {
    return c.text("frontend not built — run `pnpm build` in frontend/", 500);
  }
});

serve({ fetch: app.fetch, port: config.port, hostname: "0.0.0.0" }, (info) => {
  console.log(`homelab hub listening on :${info.port}`);
});
