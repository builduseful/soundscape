#!/usr/bin/env bash

# ./scripts/export-icons.sh

set -euo pipefail

icon_dir="${1:-src/resources/icons}"

if ! command -v inkscape >/dev/null 2>&1; then
    echo "Inkscape is required. Install it in WSL, for example: sudo apt install inkscape" >&2
    exit 1
fi

export_icon() {
    local source="$1"
    local output="$2"
    local size="$3"

    inkscape \
        --export-type=png \
        --export-filename="$icon_dir/$output" \
        --export-width="$size" \
        --export-height="$size" \
        "$icon_dir/$source"

    echo "Exported $icon_dir/$output"
}

export_icon "icon.svg" "icon-192.png" 192
export_icon "icon.svg" "icon-512.png" 512
export_icon "icon.svg" "favicon-16.png" 16
export_icon "icon.svg" "favicon-32.png" 32
export_icon "maskable-icon.svg" "apple-touch-icon.png" 180
export_icon "maskable-icon.svg" "maskable-icon-512.png" 512
