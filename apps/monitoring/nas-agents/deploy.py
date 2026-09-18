#!/usr/bin/env python3
"""Deploy the NAS monitoring agents over SSH.

The NAS is not a Dokploy host and is not on our LAN -- it is reachable only over
Tailscale, via `ssh nas`. So this is deliberately the dumbest possible deploy:
copy two files up, run `docker compose up -d`, print what came back.

    ./deploy.py              # copy up, start node_exporter + cAdvisor
    ./deploy.py --with-logs  # also start Alloy (needs .env on the NAS)
    ./deploy.py --pull       # pull newer images first
    ./deploy.py --down       # stop and remove the agents
    ./deploy.py --follow     # follow alloy's log afterwards

Alloy sits behind the `logs` compose profile because it cannot do anything
useful until the Cloudflare Access service token exists; metrics do not wait
for it.

`davide` on that box is in the `docker` group and has no passwordless sudo,
which is all this needs: the containers run as root inside, the user does not.
"""

import pathlib
import subprocess
import sys

HERE = pathlib.Path(__file__).parent
SSH_HOST = "nas"
# Absolute: modern scp speaks SFTP, which does not expand `~` on the remote.
REMOTE_DIR = "/home/davide/nas-agents"
FILES = ["compose.yml", "config.alloy"]


def ssh(command: str, check: bool = True) -> subprocess.CompletedProcess:
    return subprocess.run(["ssh", SSH_HOST, command], check=check, text=True)


def main() -> int:
    args = sys.argv[1:]

    with_logs = "--with-logs" in args
    profile = "--profile logs " if with_logs else ""

    if "--down" in args:
        ssh(f"cd {REMOTE_DIR} && docker compose --profile logs down")
        print("agents stopped")
        return 0

    ssh(f"mkdir -p {REMOTE_DIR}")

    # Piped through `cat`, not scp. UGOS chroots the SFTP subsystem that modern
    # scp speaks to a share-only root -- an `sftp` session shows just `docker`,
    # `home` and `test` at `/` -- so an absolute shell path like
    # /home/davide/nas-agents resolves to nothing over SFTP and every upload
    # fails with "No such file or directory" while `touch` on the same path
    # works fine over ssh. rsync is not installed there either.
    for name in FILES:
        with open(HERE / name, "rb") as fh:
            subprocess.run(
                ["ssh", SSH_HOST, f"cat > {REMOTE_DIR}/{name}"],
                stdin=fh,
                check=True,
            )
    print(f"copied {', '.join(FILES)}")

    # .env holds the Cloudflare Access service token and lives only on the NAS.
    # Only the logs profile needs it, so only that path insists on it.
    if with_logs:
        probe = subprocess.run(
            ["ssh", SSH_HOST, f"test -f {REMOTE_DIR}/.env"], check=False
        )
        if probe.returncode != 0:
            print(
                f"{REMOTE_DIR}/.env is missing on {SSH_HOST} — create it there "
                "from .env.example (mode 600) before deploying with --with-logs; "
                "the token must not pass through this repo.",
                file=sys.stderr,
            )
            return 1

    if "--pull" in args:
        ssh(f"cd {REMOTE_DIR} && docker compose {profile}pull")

    ssh(f"cd {REMOTE_DIR} && docker compose {profile}up -d --remove-orphans")
    ssh("docker ps --filter name=nas- --format '{{.Names}}\t{{.Status}}'")
    if not with_logs:
        print("metrics only — rerun with --with-logs once the Access token exists")

    if "--follow" in args:
        ssh(f"cd {REMOTE_DIR} && docker compose logs -f alloy", check=False)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
