#!/usr/bin/env bash
# Preview the launcher design in a browser, at the TV's real 1920x1080 surface.
set -euo pipefail
cd "$(dirname "$0")"
PORT="${PORT:-4321}"
echo "http://localhost:$PORT"
exec python3 -m http.server "$PORT"
