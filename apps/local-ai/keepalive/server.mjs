// Keepalive proxy in front of LiteLLM, for the public hostname only.
//
// Cloudflare drops a proxied request with a 524 when the origin sends nothing for 100 s,
// and that limit cannot be raised below the Enterprise plan. LiteLLM buffers the first
// streamed chunk before it sends any response headers, so a coding agent's 20-30k-token
// prompt (1-2 min of prefill here, more when queued behind someone else) goes silent for
// longer than that and gets cut.
//
// For a streaming POST to the chat, messages or responses API this proxy waits GRACE_MS
// for LiteLLM. Auth and rate-limit errors arrive well inside it and pass through with their
// own status. Past it, the proxy answers 200 text/event-stream itself and writes an SSE
// comment (": keepalive") every INTERVAL_MS until LiteLLM's stream starts, then copies it
// through. SSE clients (OpenAI, Anthropic and AI SDKs, Codex) ignore comment lines. An
// error LiteLLM returns after the 200 is sent becomes an SSE error event in the format of
// that API. Everything else is passed through untouched.
import http from "node:http";

const UPSTREAM = new URL(process.env.UPSTREAM ?? "http://litellm:4000");
const PORT = Number(process.env.PORT ?? 8080);
const GRACE_MS = Number(process.env.GRACE_MS ?? 2000);
const INTERVAL_MS = Number(process.env.INTERVAL_MS ?? 15000);
const MAX_BODY = 64 * 1024 * 1024;
const STREAM_PATH = /^\/(?:v1\/)?(chat\/completions|messages|responses)$/;
const HOP_BY_HOP = ["connection", "keep-alive", "transfer-encoding", "upgrade", "proxy-connection"];
const COMMENT = ": keepalive\n\n";

function upstreamHeaders(headers, extra = {}) {
  const out = { ...headers, ...extra };
  for (const h of HOP_BY_HOP) delete out[h];
  return out;
}

function downstreamHeaders(headers) {
  const out = { ...headers };
  for (const h of HOP_BY_HOP) delete out[h];
  return out;
}

function send(res, status, body) {
  if (res.headersSent) return res.end();
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function passthrough(req, res, body) {
  const up = http.request(
    UPSTREAM,
    {
      method: req.method,
      path: req.url,
      headers: upstreamHeaders(
        req.headers,
        body ? { "content-length": String(body.length) } : {},
      ),
    },
    (upRes) => {
      res.writeHead(upRes.statusCode, downstreamHeaders(upRes.headers));
      upRes.pipe(res);
    },
  );
  up.on("error", (err) => send(res, 502, { error: { message: `upstream: ${err.message}` } }));
  res.on("close", () => up.destroy());
  if (body) up.end(body);
  else req.pipe(up);
}

// An upstream error after the 200 went out, in the event shape each API's clients expect.
function errorEvent(api, status, raw) {
  let message = raw || `upstream returned ${status}`;
  try {
    const parsed = JSON.parse(raw);
    message = parsed?.error?.message ?? parsed?.detail ?? message;
  } catch {}
  if (typeof message !== "string") message = JSON.stringify(message);
  if (api === "messages") {
    const type = status === 429 ? "rate_limit_error" : status >= 500 ? "api_error" : "invalid_request_error";
    return `event: error\ndata: ${JSON.stringify({ type: "error", error: { type, message } })}\n\n`;
  }
  if (api === "responses") {
    return `event: error\ndata: ${JSON.stringify({ type: "error", code: String(status), message })}\n\n`;
  }
  return `data: ${JSON.stringify({ error: { message, type: "upstream_error", code: status } })}\n\n`;
}

function keepalive(req, res, body, api) {
  let committed = false; // our own 200 is out
  let clean = true; // last byte written ends an SSE event, so a comment may go next
  let tail = "";
  let lastWrite = 0;
  let ticker;

  const write = (chunk) => {
    res.write(chunk);
    lastWrite = Date.now();
  };
  const startTicker = () => {
    ticker = setInterval(() => {
      if (clean && Date.now() - lastWrite >= INTERVAL_MS - 50) write(COMMENT);
    }, INTERVAL_MS);
  };
  const finish = () => {
    clearInterval(ticker);
    res.end();
  };

  const grace = setTimeout(() => {
    committed = true;
    res.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache",
      "x-accel-buffering": "no",
    });
    write(COMMENT);
    startTicker();
  }, GRACE_MS);

  const up = http.request(
    UPSTREAM,
    {
      method: req.method,
      path: req.url,
      // identity: a gzip body could not have comments spliced into it
      headers: upstreamHeaders(req.headers, {
        "content-length": String(body.length),
        "accept-encoding": "identity",
      }),
    },
    (upRes) => {
      clearTimeout(grace);
      const ok = upRes.statusCode === 200;

      if (!committed) {
        res.writeHead(upRes.statusCode, downstreamHeaders(upRes.headers));
        if (ok && String(upRes.headers["content-type"]).startsWith("text/event-stream")) startTicker();
      } else if (!ok) {
        const chunks = [];
        upRes.on("data", (c) => chunks.push(c));
        upRes.on("end", () => {
          write(errorEvent(api, upRes.statusCode, Buffer.concat(chunks).toString()));
          finish();
        });
        return;
      }

      upRes.on("data", (chunk) => {
        write(chunk);
        tail = (tail + chunk.toString("latin1")).slice(-4);
        clean = tail.endsWith("\n\n") || tail.endsWith("\r\n\r\n");
      });
      upRes.on("end", finish);
      upRes.on("error", finish);
    },
  );

  up.on("error", (err) => {
    clearTimeout(grace);
    if (committed) {
      write(errorEvent(api, 502, `upstream: ${err.message}`));
      finish();
    } else {
      send(res, 502, { error: { message: `upstream: ${err.message}` } });
    }
  });
  // Client gone: drop the upstream request, so LiteLLM cancels it and the queue moves on.
  res.on("close", () => {
    clearTimeout(grace);
    clearInterval(ticker);
    up.destroy();
  });
  up.end(body);
}

const server = http.createServer((req, res) => {
  const path = req.url.split("?")[0];
  const match = req.method === "POST" && STREAM_PATH.exec(path);
  if (!match) return passthrough(req, res);

  const chunks = [];
  let size = 0;
  req.on("data", (c) => {
    size += c.length;
    if (size > MAX_BODY) {
      send(res, 413, { error: { message: "request body too large" } });
      req.destroy();
    } else chunks.push(c);
  });
  req.on("end", () => {
    if (res.headersSent) return;
    const body = Buffer.concat(chunks);
    let stream = false;
    try {
      stream = JSON.parse(body).stream === true;
    } catch {}
    if (stream) keepalive(req, res, body, match[1] === "chat/completions" ? "chat" : match[1]);
    else passthrough(req, res, body);
  });
});

// Answers can take many minutes; Node's own 5-minute request cap would cut them.
server.requestTimeout = 0;
server.listen(PORT, () => console.log(`keepalive: :${PORT} -> ${UPSTREAM.origin}`));
