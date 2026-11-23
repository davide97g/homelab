// status.davideghiotto.it — the homelab's public status page.
//
// Runs on Cloudflare, not on the homelab, so it stays up when the homelab does
// not. The mini PC POSTs a JSON snapshot to /api/ingest every five minutes
// (apps/status/publisher); this stores it in KV and serves it with the page.
// When snapshots stop arriving the page says so: that silence is the outage.
import page from "./index.html";

const MAX_BODY = 256 * 1024;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/" && request.method === "GET") {
      return new Response(page, {
        headers: {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "public, max-age=300",
          "x-content-type-options": "nosniff",
          "referrer-policy": "strict-origin-when-cross-origin",
          "content-security-policy":
            "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
        },
      });
    }

    if (url.pathname === "/status.json" && request.method === "GET") {
      const body = await env.STATUS.get("status");
      return new Response(body ?? "{}", {
        status: body ? 200 : 404,
        headers: {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "public, max-age=30",
          "x-content-type-options": "nosniff",
        },
      });
    }

    if (url.pathname === "/api/ingest" && request.method === "POST") {
      if (!(await authorized(request, env.INGEST_TOKEN))) {
        return new Response("unauthorized\n", { status: 401 });
      }
      const text = await request.text();
      if (text.length > MAX_BODY) return new Response("too large\n", { status: 413 });
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        return new Response("bad json\n", { status: 400 });
      }
      if (!Array.isArray(data.services) || typeof data.generated_at !== "number") {
        return new Response("bad shape\n", { status: 400 });
      }
      data.received_at = Math.floor(Date.now() / 1000);
      await env.STATUS.put("status", JSON.stringify(data));
      return new Response("ok\n");
    }

    if (url.pathname === "/favicon.ico") return new Response(null, { status: 204 });
    return new Response("not found\n", { status: 404 });
  },
};

// Compare digests, so the time taken does not depend on how much of the token matched.
async function authorized(request, token) {
  if (!token) return false;
  const given = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(given)),
    crypto.subtle.digest("SHA-256", enc.encode(token)),
  ]);
  return crypto.subtle.timingSafeEqual(a, b);
}
