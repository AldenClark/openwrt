#!/usr/bin/env bash
# Verify the firmware's package manifest before making images available.
set -euo pipefail

[[ $# -eq 1 ]] || { echo "Usage: $0 md|mf" >&2; exit 2; }
case "$1" in
    md) subtarget=an7581 ;;
    mf) subtarget=an7583 ;;
    *) echo "Usage: $0 md|mf" >&2; exit 2 ;;
esac

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
target_dir="$repo_root/bin/targets/airoha/$subtarget"
manifest="$target_dir/openwrt-airoha-$subtarget.manifest"
if [[ ! -f "$manifest" ]]; then
    shopt -s nullglob
    manifests=("$target_dir"/openwrt-airoha-"$subtarget"*.manifest)
    [[ ${#manifests[@]} -eq 1 ]] || {
        echo "Expected exactly one AirRelay manifest under $target_dir" >&2
        exit 1
    }
    manifest="${manifests[0]}"
fi

has_package() {
    awk -v name="$1" '$1 == name { found=1 } END { exit !found }' "$manifest"
}

for name in kmod-wireguard wireguard-tools firewall4 luci-mod-admin-full \
            luci-proto-wireguard luci-lib-uqr resolveip \
            luci-theme-bootstrap luci-theme-airrelay \
            uhttpd uhttpd-mod-ubus px5g-mbedtls dropbear; do
    if ! has_package "$name"; then
        echo "Required package missing: $name" >&2
        exit 1
    fi
done

for name in dnsmasq dnsmasq-full odhcpd-ipv6only ppp ppp-mod-pppoe \
            odhcp6c kmod-tun kmod-nft-tproxy strongswan kmod-usb3; do
    if has_package "$name"; then
        echo "Unexpected package included: $name" >&2
        exit 1
    fi
done

echo "AirRelay $subtarget package manifest verified."
