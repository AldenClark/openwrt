#!/usr/bin/env bash
# Fail release builds if removed drivers silently reappear in the kernel.
set -euo pipefail

[[ $# -eq 1 ]] || { echo "Usage: $0 md|mf" >&2; exit 2; }
case "$1" in
    md) subtarget=an7581; usb_phy=PHY_AIROHA_USB ;;
    mf) subtarget=an7583; usb_phy=PHY_AIROHA_AN7583_USB ;;
    *) echo "Usage: $0 md|mf" >&2; exit 2 ;;
esac

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
shopt -s nullglob
configs=("$repo_root"/build_dir/target-*/linux-airoha_"$subtarget"/linux-*/.config)
[[ ${#configs[@]} -eq 1 ]] || {
    echo "Expected one final kernel .config for airoha/$subtarget, got ${#configs[@]}" >&2
    exit 1
}
kernel_config="${configs[0]}"

for feature in EXT4_FS MMC USB_SUPPORT DEBUG_INFO "$usb_phy"; do
    # Kconfig omits symbols that are unavailable on this target. An absent
    # symbol is disabled, just like "# CONFIG_FOO is not set". Only explicit
    # y/m selections prove an unwanted feature was built.
    if grep -Eq "^CONFIG_${feature}=(y|m)$" "$kernel_config"; then
        grep -E "^CONFIG_${feature}=" "$kernel_config" >&2
        echo "Kernel unexpectedly enables CONFIG_${feature}" >&2
        exit 1
    fi
done
for feature in MTD_UBI UBIFS_FS NET_AIROHA NET_DSA PCS_AIROHA HW_RANDOM_AIROHA; do
    grep -qx "CONFIG_${feature}=y" "$kernel_config" || {
        echo "Kernel is missing critical driver: CONFIG_${feature}" >&2
        exit 1
    }
done
grep -Eq '^CONFIG_WIREGUARD=(y|m)$' "$kernel_config" || {
    echo "Kernel WireGuard was not built." >&2
    exit 1
}

echo "AirRelay $subtarget optimized kernel config verified."
