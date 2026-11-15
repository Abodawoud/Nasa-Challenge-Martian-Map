#!/usr/bin/env bash
# Puts everything a Hugging Face Space needs into one folder: deploy/space-build/
# (the Space's Dockerfile and README, the backend code, its list of packages).
# Run it from anywhere:   bash deploy/make-space.sh
# Then push the content of deploy/space-build/ to your Space. DEPLOY.md has the steps.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$(dirname "$here")"
out="$here/space-build"

rm -rf "$out"
mkdir -p "$out"
cp "$here/huggingface/Dockerfile" "$here/huggingface/README.md" "$out/"
cp "$root/backend/requirements.txt" "$out/"
cp -r "$root/backend/app" "$out/app"
# No Python cache files in the Space.
find "$out" -name "__pycache__" -type d -prune -exec rm -rf {} +

echo "Ready: $out"
ls -1 "$out"
