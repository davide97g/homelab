import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { readFile, stat } from "node:fs/promises";
import { dirname, extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { checkPassword, cookieHeader, issue, readCookie, verify } from "./auth.js";
import { nasDetail } from "./collect/nas.js";
import { summary } from "./collect/summary.js";
import { config } from "./config.js";
import { catalog, parseRequest, series } from "./prom/series.js";
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
