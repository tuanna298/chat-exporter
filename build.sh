#!/usr/bin/env bash
# Build a distributable ZIP of the Chat Exporter extension.
# Usage:
#   ./build.sh            → dist/chat-exporter-v2.0.0.zip
#   ./build.sh --open     → build then open the dist/ folder in Finder

set -euo pipefail

VERSION=$(python3 -c "import json; print(json.load(open('manifest.json'))['version'])")
OUT_DIR="dist"
OUT_FILE="${OUT_DIR}/chat-exporter-v${VERSION}.zip"

echo "▸ Building Chat Exporter v${VERSION}..."

mkdir -p "$OUT_DIR"
rm -f "$OUT_FILE"

zip -r "$OUT_FILE" \
    manifest.json \
    content.js \
    injected.js \
    background.js \
    popup.html \
    popup.js \
    icons/ \
    --quiet

SIZE=$(du -sh "$OUT_FILE" | cut -f1)
echo "✓ ${OUT_FILE}  (${SIZE})"

if [[ "${1:-}" == "--open" ]]; then
    open "$OUT_DIR"
fi
