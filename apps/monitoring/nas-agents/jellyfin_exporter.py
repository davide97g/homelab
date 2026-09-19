#!/usr/bin/env python3
"""Prometheus metrics for who is watching what on the NAS's Jellyfin.

Jellyfin has no /metrics of its own and the server is deliberately unmodified --
no plugin, which is the rule the Cinema repo is built on -- so this reads the
same endpoint the Cinema web app reads, `GET /Sessions`, and maps it.

Stdlib only, so it runs in a bare `python:*-alpine` with the script bind-mounted
and no image to build on a box that is not ours.

    JELLYFIN_URL=http://127.0.0.1:8899 JELLYFIN_API_KEY=... ./jellyfin_exporter.py

Cardinality: one series per *active* session, labelled with the user and the
title. On a home server that is zero to a handful at a time, and the labels are
the entire point of the panel -- "two people watching" without who and what is
not worth scraping. Finished sessions stop being exported the moment they stop
playing, so the churn is in the TSDB's head block, not in a growing label set.
"""

import json
import os
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

JELLYFIN_URL = os.environ.get("JELLYFIN_URL", "http://127.0.0.1:8899").rstrip("/")
API_KEY = os.environ.get("JELLYFIN_API_KEY", "").strip()
LISTEN_HOST = os.environ.get("LISTEN_HOST", "127.0.0.1")
LISTEN_PORT = int(os.environ.get("LISTEN_PORT", "9101"))
TIMEOUT = float(os.environ.get("JELLYFIN_TIMEOUT", "5"))

# The same window the Cinema pill uses: a client that dies without reporting
# /Stopped otherwise lingers for its full server-side timeout and would be
# counted as a viewer long after the tab closed.
ACTIVE_WITHIN_SECONDS = 90

TICKS_PER_SECOND = 10_000_000


def fetch_sessions() -> list[dict]:
    request = urllib.request.Request(
        f"{JELLYFIN_URL}/Sessions?activeWithinSeconds={ACTIVE_WITHIN_SECONDS}",
        headers={
            # The token form current Jellyfin documents. `api_key` in the query
            # string still works and still ends up in every access log.
            "Authorization": f'MediaBrowser Token="{API_KEY}"',
            "Accept": "application/json",
        },
    )
    with urllib.request.urlopen(request, timeout=TIMEOUT) as response:
        return json.loads(response.read().decode("utf-8"))


def escape(value: str) -> str:
    return value.replace("\\", "\\\\").replace('"', '\\"').replace("\n", " ")


def labels(pairs: dict[str, str]) -> str:
    return ",".join(f'{key}="{escape(str(value))}"' for key, value in pairs.items())


def title_of(item: dict) -> str:
    """What the item is called, the way a person would say it."""
    if item.get("Type") == "Episode":
        series = item.get("SeriesName") or ""
        season = item.get("ParentIndexNumber")
        episode = item.get("IndexNumber")
        if series and season is not None and episode is not None:
            return f"{series} S{season}E{episode}"
        return series or item.get("Name") or "Unknown"
    return item.get("Name") or "Unknown"


def render() -> str:
    lines = [
        "# HELP jellyfin_up Whether the last scrape of the Jellyfin API succeeded.",
        "# TYPE jellyfin_up gauge",
    ]

    if not API_KEY:
        # No key is a configuration state, not an error to retry into a 401 loop.
        lines += ["jellyfin_up 0", "# jellyfin_exporter: JELLYFIN_API_KEY is empty"]
        return "\n".join(lines) + "\n"

    started = time.monotonic()
    try:
        sessions = fetch_sessions()
    except (urllib.error.URLError, TimeoutError, ValueError) as error:
        lines += ["jellyfin_up 0", f"# jellyfin_exporter: {escape(str(error))}"]
        return "\n".join(lines) + "\n"

    watching = [session for session in sessions if session.get("NowPlayingItem")]
    transcoding = [session for session in watching if session.get("TranscodingInfo")]

    lines += [
        "jellyfin_up 1",
        "# HELP jellyfin_sessions_total Sessions known to the server, playing or idle.",
        "# TYPE jellyfin_sessions_total gauge",
        f"jellyfin_sessions_total {len(sessions)}",
        "# HELP jellyfin_sessions_watching Sessions with something playing right now.",
        "# TYPE jellyfin_sessions_watching gauge",
        f"jellyfin_sessions_watching {len(watching)}",
        "# HELP jellyfin_sessions_transcoding Playing sessions the server is transcoding for.",
        "# TYPE jellyfin_sessions_transcoding gauge",
        f"jellyfin_sessions_transcoding {len(transcoding)}",
        "# HELP jellyfin_session_position_seconds How far into the item this session is.",
        "# TYPE jellyfin_session_position_seconds gauge",
    ]

    position_lines: list[str] = []
    runtime_lines: list[str] = []
    progress_lines: list[str] = []
    bitrate_lines: list[str] = []

    for session in watching:
        item = session["NowPlayingItem"]
        play_state = session.get("PlayState") or {}
        transcode = session.get("TranscodingInfo") or {}

        tags = labels(
            {
                "user": session.get("UserName") or "unknown",
                "item": title_of(item),
                "kind": item.get("Type") or "unknown",
                "client": session.get("Client") or "unknown",
                "device": session.get("DeviceName") or "unknown",
                # DirectPlay, DirectStream or Transcode -- the difference between
                # the box doing nothing and the box running ffmpeg.
                "method": play_state.get("PlayMethod") or "unknown",
                "paused": "true" if play_state.get("IsPaused") else "false",
            }
        )

        position = (play_state.get("PositionTicks") or 0) / TICKS_PER_SECOND
        runtime = (item.get("RunTimeTicks") or 0) / TICKS_PER_SECOND

        position_lines.append(f"jellyfin_session_position_seconds{{{tags}}} {position:.0f}")
        runtime_lines.append(f"jellyfin_session_runtime_seconds{{{tags}}} {runtime:.0f}")
        # Precomputed rather than divided in PromQL: the two series carry the same
        # labels but a panel that divides them still has to match them up, and a
        # zero runtime (a live stream) would give it a division by zero.
        ratio = position / runtime if runtime else 0.0
        progress_lines.append(f"jellyfin_session_progress_ratio{{{tags}}} {ratio:.4f}")
        if transcode.get("Bitrate"):
            bitrate_lines.append(
                f"jellyfin_session_transcode_bitrate_bits{{{tags}}} {int(transcode['Bitrate'])}"
            )

    lines += position_lines
    lines += [
        "# HELP jellyfin_session_runtime_seconds How long the item playing is.",
        "# TYPE jellyfin_session_runtime_seconds gauge",
    ] + runtime_lines
    lines += [
        "# HELP jellyfin_session_progress_ratio Position over runtime, 0 to 1.",
        "# TYPE jellyfin_session_progress_ratio gauge",
    ] + progress_lines
    lines += [
        "# HELP jellyfin_session_transcode_bitrate_bits Bitrate of an active transcode.",
        "# TYPE jellyfin_session_transcode_bitrate_bits gauge",
    ] + bitrate_lines
    lines += [
        "# HELP jellyfin_scrape_duration_seconds Time the Jellyfin API took to answer.",
        "# TYPE jellyfin_scrape_duration_seconds gauge",
        f"jellyfin_scrape_duration_seconds {time.monotonic() - started:.4f}",
    ]

    return "\n".join(lines) + "\n"


class Handler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:  # noqa: N802 -- BaseHTTPRequestHandler's spelling
        if self.path.split("?")[0] not in ("/metrics", "/"):
            self.send_error(404)
            return
        body = render().encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *_args) -> None:
        """Silence the per-request line: Prometheus scrapes this every minute."""


def main() -> None:
    server = ThreadingHTTPServer((LISTEN_HOST, LISTEN_PORT), Handler)
    print(f"jellyfin_exporter listening on {LISTEN_HOST}:{LISTEN_PORT}, reading {JELLYFIN_URL}")
    server.serve_forever()


if __name__ == "__main__":
    main()
