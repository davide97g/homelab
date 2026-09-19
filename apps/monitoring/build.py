#!/usr/bin/env python3
"""Assemble docker-compose.yml from compose.base.yml + dashboards/*.json.

The dashboards are inlined as compose `configs` so the resulting compose file is
a single self-contained artifact that can be pasted straight into Dokploy.
"""

import json
import pathlib
import sys

HERE = pathlib.Path(__file__).parent
INDENT = " " * 6  # under `configs: <name>: content: |`

PLACEHOLDERS = {
    "__DASHBOARD_OVERVIEW__": "dashboards/homelab-overview.json",
    "__DASHBOARD_LOGS__": "dashboards/homelab-logs.json",
}


# The three.js panel's code lives as a real .js file, not as one escaped line
# inside the dashboard, so it can be read and edited. It is substituted into the
# panel option of the same name before the dashboard is serialised.
JS_PARTIALS = {
    "__VIEWERS_3D_JS__": "dashboards/viewers-3d.js",
}


def substitute_js(node):
    """Replace placeholder strings anywhere in a dashboard with the file's code."""
    if isinstance(node, dict):
        return {key: substitute_js(value) for key, value in node.items()}
    if isinstance(node, list):
        return [substitute_js(value) for value in node]
    if isinstance(node, str) and node in JS_PARTIALS:
        return (HERE / JS_PARTIALS[node]).read_text()
    return node


def inline(path: pathlib.Path) -> str:
    data = substitute_js(json.loads(path.read_text()))
    # `$` starts a variable reference in a compose file, and Grafana dashboards
    # are full of them (template variables). Double them so compose emits one.
    # Compact, not indented: Dokploy writes the compose file by passing its whole
    # content as one shell argument, and the kernel refuses an argument over
    # 128 KiB with E2BIG -- which fails the deployment at "Initializing
    # deployment" with nothing in the deployment log to say why. Pretty-printing
    # two dashboards put the file at 108 KB and over that ceiling once Dokploy's
    # own escaping was added. The dashboards stay indented in `dashboards/`,
    # which is where they are read and diffed.
    text = json.dumps(data, separators=(",", ":")).replace("$", "$$")
    return "\n".join(INDENT + line for line in text.splitlines())


def main() -> int:
    out = (HERE / "compose.base.yml").read_text()
    for placeholder, relpath in PLACEHOLDERS.items():
        if placeholder not in out:
            print(f"missing placeholder {placeholder}", file=sys.stderr)
            return 1
        out = out.replace(placeholder, inline(HERE / relpath))

    out = out.replace(
        "# GENERATED FILE when built as docker-compose.yml — edit compose.base.yml and\n"
        "# dashboards/*.json, then run ./build.py.",
        "# GENERATED FILE — do not edit. Edit compose.base.yml and dashboards/*.json,\n"
        "# then run ./build.py.",
    )

    target = HERE / "docker-compose.yml"
    target.write_text(out)
    print(f"wrote {target.name} ({len(out.splitlines())} lines)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
