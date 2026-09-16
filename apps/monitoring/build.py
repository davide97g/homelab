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
}


def inline(path: pathlib.Path) -> str:
    data = json.loads(path.read_text())
    # `$` starts a variable reference in a compose file, and Grafana dashboards
    # are full of them (template variables). Double them so compose emits one.
    text = json.dumps(data, indent=2).replace("$", "$$")
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
