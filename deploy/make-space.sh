#!/usr/bin/env bash
# Puts everything the free Hugging Face Space needs into one folder: deploy/space-build/
#   app.py            starts the backend inside a Gradio Space
#   requirements.txt  the Python packages
#   packages.txt      one system library
#   mapapi/           a copy of backend/app (the backend code itself)
# Run it from anywhere:   bash deploy/make-space.sh
# Then upload the content of deploy/space-build/ to your Space. DEPLOY.md has the steps.
# Do NOT upload a README.md: keep the one Hugging Face made for the Space.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$(dirname "$here")"
out="$here/space-build"

rm -rf "$out"
mkdir -p "$out"
cp "$here/huggingface-gradio/app.py" "$here/huggingface-gradio/requirements.txt" "$here/huggingface-gradio/packages.txt" "$out/"
cp -r "$root/backend/app" "$out/mapapi"
# No Python cache files in the Space.
find "$out" -name "__pycache__" -type d -prune -exec rm -rf {} +

echo "Ready: $out"
ls -1 "$out"
