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

# A lean image must not silently fall back to generic router or BusyBox
# defaults when upstream package names and Kconfig constraints change.
for feature in \
    CONFIG_PACKAGE_kmod-wireguard \
    CONFIG_PACKAGE_wireguard-tools \
    CONFIG_PACKAGE_luci-mod-admin-full \
    CONFIG_PACKAGE_luci-theme-airrelay \
    CONFIG_PACKAGE_luci-proto-wireguard \
    CONFIG_LUCI_LANG_zh_Hans \
    CONFIG_PACKAGE_luci-i18n-airrelay-zh-cn \
    CONFIG_IMAGEOPT \
    CONFIG_VERSIONOPT \
    CONFIG_BUSYBOX_CUSTOM \
    CONFIG_BUSYBOX_CONFIG_UDHCPC \
    CONFIG_BUSYBOX_CONFIG_NTPD; do
    grep -qx "${feature}=y" .config || {
        echo "Required configuration was not enabled: ${feature}" >&2
        exit 1
    }
done
for feature in \
    CONFIG_PACKAGE_dnsmasq \
    CONFIG_PACKAGE_luci-theme-bootstrap \
    CONFIG_PACKAGE_odhcp6c \
    CONFIG_KERNEL_DEBUG_INFO \
    CONFIG_BUSYBOX_CONFIG_UDHCPD \
    CONFIG_BUSYBOX_CONFIG_CROND \
    CONFIG_BUSYBOX_CONFIG_CRONTAB \
    CONFIG_BUSYBOX_CONFIG_FEATURE_NTPD_SERVER; do
    grep -qx "# ${feature} is not set" .config || {
        echo "Unwanted configuration was enabled: ${feature}" >&2
        exit 1
    }
done

grep -qx 'CONFIG_VERSION_DIST="AirRelay OS"' .config || {
    echo "AirRelay distribution branding was not retained by defconfig" >&2
    exit 1
}

echo "AirRelay ${device^^} configuration ready. Review .config before building."
