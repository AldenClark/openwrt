#!/usr/bin/env bash
# Prepare one clean OpenWrt source checkout for a single AirRelay device.
set -euo pipefail

usage() {
    echo "Usage: $0 md|mf" >&2
    exit 2
}

[[ $# -eq 1 ]] || usage
case "$1" in
    md|mf) device="$1" ;;
    *) usage ;;
esac

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$repo_root"

# OpenWrt ignores its local files/ overlay and .config by default. Do not
# silently replace a developer's existing build settings or custom overlay.
if [[ -e .config || -e files ]]; then
    echo "Refusing to overwrite existing .config or files/. Use a clean checkout." >&2
    exit 1
fi

cp "airrelay/configs/${device}.config" .config
mkdir -p files
cp -a airrelay/overlay/. files/
make defconfig

echo "AirRelay ${device^^} configuration ready. Review .config before building."
