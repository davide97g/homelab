#!/usr/bin/env python3
"""memories-upload: chunked uploads for Immich behind Cloudflare's 100 MB request cap.

The iPhone app writes the same multipart body it would POST to /api/assets, cuts it into
pieces under the cap and PUTs them one after another:

    PUT <api>/memories/upload/<upload-id>/<index>
        Authorization: Bearer <immich token>       (or x-api-key)
        X-Upload-Chunks: <total number of pieces>
        X-Upload-Content-Type: multipart/form-data; boundary=...
        X-Immich-Checksum: <sha1 hex>               (optional, passed on)

Every piece but the last answers 202. The last one makes the relay stream the pieces, in
order, to Immich's own POST /api/assets with the caller's credentials, and answers with
Immich's status and body -- so to the app it looks like a normal upload.

A piece sent twice is fine (written again). A finished upload remembers Immich's answer for
a while, so repeating the last piece (its answer got lost, or Cloudflare gave up waiting)
returns the same result instead of uploading again. Unfinished uploads are dropped after
MAX_AGE. Python stdlib only.
"""

import hashlib
import http.client
import json
import os
import re
import shutil
import sys
import threading
import time
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

UPSTREAM = urllib.parse.urlsplit(os.environ.get("IMMICH_UPSTREAM", "http://immich_server:2283"))
DATA = os.environ.get("DATA_DIR", "/data")
PORT = int(os.environ.get("PORT", "8080"))
MAX_CHUNK = int(os.environ.get("MAX_CHUNK", str(95 * 1000 * 1000)))
MAX_CHUNKS = int(os.environ.get("MAX_CHUNKS", "500"))  # ~47 GB
MAX_AGE = int(os.environ.get("MAX_AGE_HOURS", "48")) * 3600
IO = 1 << 20

ROUTE = re.compile(r"^.*/memories/upload/(?:(config)|([0-9a-fA-F-]{36})/(\d{1,4}))/?$")

_locks: dict[str, threading.Lock] = {}
_locks_guard = threading.Lock()
_auth_cache: dict[str, float] = {}
_auth_guard = threading.Lock()


def log(*a):
    print(time.strftime("%Y-%m-%dT%H:%M:%S"), *a, file=sys.stderr, flush=True)


def lock_for(upload_id: str) -> threading.Lock:
    with _locks_guard:
        return _locks.setdefault(upload_id, threading.Lock())


def upstream() -> http.client.HTTPConnection:
    port = UPSTREAM.port or (443 if UPSTREAM.scheme == "https" else 80)
    cls = http.client.HTTPSConnection if UPSTREAM.scheme == "https" else http.client.HTTPConnection
    return cls(UPSTREAM.hostname, port, timeout=900)


def auth_headers(h) -> dict[str, str]:
    out = {}
    for k in ("Authorization", "x-api-key"):
        v = h.get(k)
        if v:
            out[k] = v
    return out


def check_auth(creds: dict[str, str]) -> int:
    """200 when Immich accepts these credentials (cached for a minute), else Immich's status."""
    if not creds:
        return 401
    key = hashlib.sha256(json.dumps(creds, sort_keys=True).encode()).hexdigest()
    now = time.time()
    with _auth_guard:
        if _auth_cache.get(key, 0) > now:
            return 200
    conn = upstream()
    try:
        conn.request("GET", "/api/users/me", headers={**creds, "Accept": "application/json"})
        res = conn.getresponse()
        res.read()
        status = res.status
    except OSError as e:
        log("auth check failed:", e)
        return 502
    finally:
        conn.close()
    if status == 200:
        with _auth_guard:
            _auth_cache[key] = now + 60
    return status


def owner_of(creds: dict[str, str]) -> str:
    return hashlib.sha256(json.dumps(creds, sort_keys=True).encode()).hexdigest()


def gc_loop():
    while True:
        try:
            cutoff = time.time() - MAX_AGE
            for name in os.listdir(DATA):
                p = os.path.join(DATA, name)
                if os.path.isdir(p) and os.path.getmtime(p) < cutoff:
                    shutil.rmtree(p, ignore_errors=True)
                    log("expired", name)
        except OSError as e:
            log("gc:", e)
        time.sleep(600)


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "memories-upload/1"

    def log_message(self, fmt, *args):
        log(self.address_string(), fmt % args)

    def reply(self, status: int, body: bytes | dict, ctype="application/json"):
        if isinstance(body, dict):
            body = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def drain(self):
        n = int(self.headers.get("Content-Length") or 0)
        while n > 0:
            got = self.rfile.read(min(IO, n))
            if not got:
                break
            n -= len(got)

    def do_GET(self):
        m = ROUTE.match(urllib.parse.urlsplit(self.path).path)
        if m and m.group(1):
            return self.reply(200, {"version": 1, "maxChunkSize": MAX_CHUNK, "maxChunks": MAX_CHUNKS})
        self.reply(404, {"message": "not found"})

    def do_PUT(self):
        m = ROUTE.match(urllib.parse.urlsplit(self.path).path)
        if not m or not m.group(2):
            self.drain()
            return self.reply(404, {"message": "not found"})
        upload_id, index = m.group(2).lower(), int(m.group(3))
        try:
            chunks = int(self.headers.get("X-Upload-Chunks", ""))
            length = int(self.headers.get("Content-Length", ""))
        except ValueError:
            self.drain()
            return self.reply(400, {"message": "X-Upload-Chunks and Content-Length are required"})
        ctype = self.headers.get("X-Upload-Content-Type", "")
        if not (0 < chunks <= MAX_CHUNKS and 0 <= index < chunks and 0 < length <= MAX_CHUNK
                and ctype.startswith("multipart/form-data")):
            self.drain()
            return self.reply(400, {"message": "bad chunk"})

        creds = auth_headers(self.headers)
        status = check_auth(creds)
        if status != 200:
            self.drain()
            return self.reply(401 if status in (401, 403) else 502, {"message": "not signed in to Immich"})

        d = os.path.join(DATA, upload_id)
        with lock_for(upload_id):
            os.makedirs(d, exist_ok=True)
            meta_path = os.path.join(d, "meta.json")
            meta = {"chunks": chunks, "contentType": ctype, "owner": owner_of(creds),
                    "checksum": self.headers.get("X-Immich-Checksum"), "created": time.time()}
            if os.path.exists(meta_path):
                with open(meta_path) as f:
                    old = json.load(f)
                if old["owner"] != meta["owner"] or old["chunks"] != chunks:
                    self.drain()
                    return self.reply(409, {"message": "upload id belongs to another upload"})
            else:
                with open(meta_path, "w") as f:
                    json.dump(meta, f)

            done = os.path.join(d, "result.json")
            if os.path.exists(done):
                self.drain()
                with open(done) as f:
                    r = json.load(f)
                return self.reply(r["status"], r["body"].encode())

            part = os.path.join(d, f"{index:05d}.part")
            tmp = part + ".tmp"
            left = length
            with open(tmp, "wb") as f:
                while left > 0:
                    got = self.rfile.read(min(IO, left))
                    if not got:
                        break
                    f.write(got)
                    left -= len(got)
            if left:
                os.unlink(tmp)
                return self.reply(400, {"message": "body shorter than Content-Length"})
            os.replace(tmp, part)
            os.utime(d)

            if index < chunks - 1:
                return self.reply(202, {"received": index, "chunks": chunks})

            parts = [os.path.join(d, f"{i:05d}.part") for i in range(chunks)]
            missing = [i for i, p in enumerate(parts) if not os.path.exists(p)]
            if missing:
                return self.reply(409, {"message": "missing chunks", "missing": missing})
            with open(meta_path) as f:
                meta = json.load(f)
            return self.forward(d, parts, meta, creds)

    def forward(self, d, parts, meta, creds):
        total = sum(os.path.getsize(p) for p in parts)
        headers = {**creds, "Content-Type": meta["contentType"], "Content-Length": str(total),
                   "Accept": "application/json"}
        if meta.get("checksum"):
            headers["x-immich-checksum"] = meta["checksum"]
        started = time.time()
        conn = upstream()
        try:
            conn.putrequest("POST", "/api/assets")
            for k, v in headers.items():
                conn.putheader(k, v)
            conn.endheaders()
            for p in parts:
                with open(p, "rb") as f:
                    while chunk := f.read(IO):
                        conn.send(chunk)
            res = conn.getresponse()
            body = res.read()
            status = res.status
        except OSError as e:
            log("forward failed:", os.path.basename(d), e)
            return self.reply(502, {"message": f"Immich didn't take the upload: {e}"})
        finally:
            conn.close()
        log("forwarded", os.path.basename(d), f"{total} bytes in {len(parts)} pieces",
            f"-> {status} in {time.time() - started:.1f}s")
        if 200 <= status < 300:
            with open(os.path.join(d, "result.json"), "w") as f:
                json.dump({"status": status, "body": body.decode("utf-8", "replace")}, f)
            for p in parts:
                os.unlink(p)
        elif 400 <= status < 500:
            shutil.rmtree(d, ignore_errors=True)
        return self.reply(status, body)


def main():
    os.makedirs(DATA, exist_ok=True)
    threading.Thread(target=gc_loop, daemon=True).start()
    srv = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    srv.daemon_threads = True
    log(f"memories-upload on :{PORT}, upstream {UPSTREAM.geturl()}, data {DATA}, max chunk {MAX_CHUNK}")
    srv.serve_forever()


if __name__ == "__main__":
    main()
