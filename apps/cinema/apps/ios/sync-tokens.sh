#!/usr/bin/env bash
#
# Copy the generated palette into the Swiftfin fork.
#
#   bun run tokens          # runs this script with --if-present
#   apps/ios/sync-tokens.sh # or on its own
#
# The fork is a separate git repository, so the token build deliberately does
# not write into it: the palette lands here as an ordinary, reviewable commit
# in the fork's own history. Shared/ is an Xcode file-system synchronized
# group, so a file dropped into it joins the target with no project edit.
#
# --if-present exits quietly when the submodule is absent, which is how the
# tokens script can call this unconditionally and a submodule-less clone can
# still build the web app.
set -euo pipefail

cd "$(dirname "$0")/../.."

SRC=apps/ios/generated/CinemaTokens.swift
DEST=apps/ios/Swiftfin/Shared/Cinema/CinemaTokens.swift

[ -d apps/ios/Swiftfin ] || {
  [ "${1:-}" = --if-present ] && exit 0
  echo "apps/ios/Swiftfin is not checked out -- run apps/ios/bootstrap.sh first." >&2
  exit 1
}

mkdir -p "$(dirname "$DEST")"
cp "$SRC" "$DEST"
echo "✓ $SRC -> $DEST"
