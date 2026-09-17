#!/usr/bin/env bash
#
# Copy the generated palette into the Swiftfin fork.
#
#   bun run tokens && apps/ios/sync-tokens.sh
#
# The fork is a separate git repository, so the token build deliberately does
# not write into it: the palette lands here as an ordinary, reviewable commit
# in the fork's own history. Shared/ is an Xcode file-system synchronized
# group, so a file dropped into it joins the target with no project edit.
set -euo pipefail

cd "$(dirname "$0")/../.."

SRC=apps/ios/generated/CinemaTokens.swift
DEST=apps/ios/Swiftfin/Shared/Cinema/CinemaTokens.swift

[ -d apps/ios/Swiftfin ] || {
  echo "apps/ios/Swiftfin is not checked out -- run apps/ios/bootstrap.sh first." >&2
  exit 1
}

mkdir -p "$(dirname "$DEST")"
cp "$SRC" "$DEST"
echo "✓ $SRC -> $DEST"
