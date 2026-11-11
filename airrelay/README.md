# AirRelay OS — Nokia XG-040G-MD / XG-040G-MF

Minimal OpenWrt images for the **second-hop AirRelay exit node**. These are
not general-purpose customer routers. The intended traffic path is:

1. A first-hop server sends IPv4 packets over **Linux kernel WireGuard**.
2. Linux forwards packets from the WireGuard interface to the copper uplink.
3. nftables performs IPv4 masquerading for direct Internet egress.
4. A future Rust AirRelay Agent handles enrollment, cloud configuration and
   WireGuard peer lifecycle. It does **not** process data-plane packets.

The two supported devices are:

| Device | SoC | Target | Image layout |
| --- | --- | --- | --- |
| Nokia XG-040G-MD | Airoha AN7581 | `airoha/an7581` | UBI |
| Nokia XG-040G-MF | Airoha AN7583 | `airoha/an7583` | UBI |

> **Flash warning:** The UBI profiles assume the compatible UBI boot layout.
> Do not flash UBI sysupgrade images onto an unconverted stock-partition
> installation. This project does not install or change BL2, BL31 or U-Boot.
> Preserve a verified serial/bootloader recovery path before flashing.

## Image contents

- **Included:** SoC Ethernet / DSA / PHY, NAND/UBI, procd, UCI/ubus, netifd,
  Dropbear, firewall4/nftables IPv4 NAT, kernel WireGuard (`kmod-wireguard`),
  `wireguard-tools`, and a small bilingual LuCI HTTPS UI with the **AirRelay Console**
  theme, `luci-proto-wireguard`, `uhttpd`, `uhttpd-mod-ubus`, and `px5g-mbedtls`.
- **Excluded:** DHCP server, PPPoE, Wi-Fi, PON userspace, VoIP, strongSwan,
  AirRoute Core, userspace WireGuard, TUN and TPROXY modules.
- The upstream NPU/crypto support and necessary PHY/flash drivers are
  intentionally retained pending hardware validation.
- The Nokia common DTS disables PON PCS. Ethernet PCS remains enabled.
- Stage 1 removes unused MMC/SD, ext4, USB support and debug features
  from the AN7581/AN7583 kernel configurations, while preserving SPI NAND,
  UBI, Ethernet/PCS, NPU, hardware RNG and watchdog support. These kernel
  configurations are shared by other devices in each OpenWrt subtarget; this
  dedicated fork only builds the Nokia UBI profiles.
- `NET_SELFTESTS` is retained: Linux 6.18 gives this hidden kernel feature a
  `PHYLIB` default and the required DSA switch framework also implies it.
  It provides kernel Ethernet/PHY self-test helpers, not a resident userspace
  testing service. Removing it would require patching upstream Kconfig and
  would not yield a meaningful reduction in idle resource use.
- OpenWrt's top-level `CONFIG_KERNEL_DEBUG_INFO` is explicitly disabled in
  the MD/MF build profiles. This selects Linux's `CONFIG_DEBUG_INFO_NONE=y`
  choice: changing only the target kernel fragment is insufficient, since
  OpenWrt normally enables reduced DWARF debug info for non-small-flash
  targets.
- BusyBox is customized to keep `udhcpc` and NTP client functionality while
  dropping DHCP server, cron and NTP server applets. This sets OpenWrt's
  custom-BusyBox (tainted) build flag intentionally.
- Both Airoha subtargets use OpenWrt's `DEVICE_TYPE=basic` baseline. The
  generic `router` baseline forcibly selected dnsmasq/PPP/odhcp packages
  even when a package fragment requested that they be disabled. firewall4
  and nftables are enabled explicitly for our exit-node dataplane.

## AirRelay Console (default web UI)

Both UBI images bundle `luci-theme-airrelay` as the default LuCI theme, with
up to three top-level navigation items:

1. **Realtime status:** uptime, load, memory, management IPv4, port carriers,
   WireGuard interface state and tunnel IPv4 / counters / sampled rates.
   Live readings refresh every five seconds through existing `ubus` services.
   A small procd service (`airrelay-traffic`) samples `br-lan` byte counters
   every 15 seconds even with no browser open. It atomically retains 241
   counter snapshots in `/tmp/airrelay-traffic/history`, giving up to one hour
   of rates. Data stays in RAM, is cleared on reboot, and never writes flash.
   Charts use a fixed one-hour time axis and break on counter resets or gaps.
   Bridge counters do not cover all hardware-switched traffic; interface-up
   remains distinct from a successful WireGuard handshake. Each tunnel has a
   permission-checked restart action. The helper validates its UCI protocol
   and enabled state, then calls only that netifd interface down/up; it never
   reloads the whole network or changes persistent configuration.
2. **Settings:** management `br-lan` DHCP client or static IPv4 configuration
   with LuCI's Save & Apply / rollback workflow, followed by system management.
   Firmware upgrade retains authenticated upload, `validate_firmware_image`
   and `sysupgrade --test`, with no forced flashing. Factory reset requires
   confirmation before LuCI's native `/sbin/firstboot -r -y` operation. After
   reset the device uses DHCP; find its new address in the upstream lease table.
   The manual WireGuard editor preserves existing interface names and peers,
   supports creating a first tunnel, and uses native UCI confirmed apply.
   It fills missing tunnel-zone membership, outbound forwarding/NAT, and
   explicit UDP listener rules; existing firewall assignments remain intact.
   The editor refuses default-route takeover and rechecks Agent ownership
   before saving. Peer routes are enabled and keepalive is fixed at 25 seconds
   when the manual configuration is saved. Private / preshared keys stay
   concealed, and the last remaining peer cannot be removed. Agent detection uses the OpenWrt rc service `airroute-agent`:
   an installed and enabled service shows the Agent navigation item; enabled
   or still-running services suppress manual editing. Detection failure hides
   the editor. A future Agent package must install that init service name.
   Old `/network` and `/upgrade` URLs alias this page.
3. **AirRoute Agent:** installation state only; no Agent is bundled.

The standard `luci-mod-admin-full` back-end views remain installed for
development and recovery, but they are **not shown in the AirRelay navigation**.
This is a UI simplification, **not** a new authorization boundary. Only the
standalone AirRelay skin is installed; it has independent login, form and
upgrade styling, while preserving LuCI's existing authentication, RPCs and
CSRF protections. English and complete Simplified Chinese translations are
included. Switch languages at the top right; Chinese is the fresh-image default.

If a preserved pre-AirRelay configuration points to a removed skin, repair the
active theme through SSH:

```sh
uci set luci.main.mediaurlbase='/luci-static/airrelay'
uci commit luci
/etc/init.d/uhttpd reload
```

Do not expose development LuCI to an untrusted WAN. Set the administrator
password before deployment; the link remains available from the console.

## Default network and security posture

At factory reset, the upstream Nokia board initialization creates a bridge
with `lan1 lan2 lan3 lan4`. The AirRelay UCI default changes that bridge's
**management interface to a DHCP client** and disables any pre-existing LAN
DHCP server configuration. Plug the device into a network that provides DHCP;
find the assigned address in the upstream router's lease table.

There is no separate WAN port, no DHCP server, and no static `192.168.1.1`
address. All four copper interfaces remain on the same L2 bridge. The
default firewall:

- rejects unsolicited input and forwarding by default;
- permits DHCP client replies on the copper uplink;
- allows SSH (22) and LuCI HTTPS (443) only from RFC1918 IPv4 source ranges
  on the uplink for **initial development**;
- provides a `tunnel` zone referencing the future UCI network `wg0`;
- forwards `wg0` → `lan`, with IPv4 masquerading on the physical uplink.

**Before exposing a node to an untrusted network, set an administrator
password and tighten or remove the development management rules.** LuCI is
retained temporarily for troubleshooting, and is not the future cloud API.
IPv6 forwarding is disabled until an explicit IPv6 routing/security policy
is designed. Use IPv4 uplink connectivity for the initial tests.

The Agent must create `config interface 'wg0'` with `option proto 'wireguard'`
and its peer sections through UCI/netifd. It must not install a default route
through `wg0` on the exit node. Assign unique, non-overlapping `AllowedIPs`
to each first-hop peer. The future Agent must validate cloud input, avoid
shell interpolation, persist sensitive keys with root-only permissions, and
roll back bad changes if a tunnel cannot be established.

## Upstream baseline and update policy

AirRelay OS is maintained on this repository's `main` branch. The fork is
based on the OpenWrt upstream source snapshot
[`3d5a743f1f0cb77aed8ed63b2f9aa75700b4322c`](https://github.com/openwrt/openwrt/commit/3d5a743f1f0cb77aed8ed63b2f9aa75700b4322c)
(November 2026), plus the AirRelay-specific changes in this repository.
This is an **upstream development snapshot**, not a claim that the firmware
is based on an officially released stable OpenWrt version.

- Do **not** automatically synchronize `main` with OpenWrt upstream.
- Consider an upstream rebase/migration **only after an official major stable
  OpenWrt release**, on a separate integration branch. Adoption requires
  review of AN7581/AN7583 driver changes, firmware images, data-plane
  behavior and hardware recovery paths; it is never automatic.
- The official `packages` and `luci` feed revisions are pinned separately
  in `airrelay/feeds.conf`. Update them only through an intentional,
  validated change.
- All GitHub Actions workflows are **manual-only** (`workflow_dispatch`).
  To build MD and MF images, choose **Actions → AirRelay OS (MD / MF) →
  Run workflow** on `main`. Commits, PRs, tags and schedules cannot initiate
  a build.

## Reproducible build

Use a **fresh checkout for each device** on a Linux build host. Record the
exact AirRelay OS `main` commit used for production firmware. This fork does
not automatically follow OpenWrt upstream; the selected official feeds are
locked to known revisions in `airrelay/feeds.conf`.

```sh
cp airrelay/feeds.conf feeds.conf
./scripts/feeds update packages luci
./scripts/feeds install -p luci luci-mod-admin-full luci-proto-wireguard

bash airrelay/scripts/configure.sh md  # or: mf, in a separate clean checkout
make download -j2
make -j2
bash airrelay/scripts/check-kernel-config.sh md
bash airrelay/scripts/check-image.sh md
```

The dedicated LuCI theme is built from the local
`package/airrelay/luci-theme-airrelay/` source tree, rather than an additional
third-party feed. It uses the pinned official LuCI build helpers, so JavaScript
views and ucode templates are checked and packaged together with the firmware.

`configure.sh` intentionally refuses to overwrite an existing `.config` or
local `files/` overlay. The version-controlled overlay lives in
`airrelay/overlay/`; OpenWrt normally ignores its build-time `files/` folder.

The GitHub Actions workflow **AirRelay OS (MD / MF)** builds both
devices. Its artifacts include UBI sysupgrade/recovery images, a package
manifest, build configuration, and image checksums. It publishes a unique
**prerelease** with MD and MF images only when **both** device builds pass.
It does **not** flash hardware or change bootloaders. Start it manually on
`main` through **Actions → AirRelay OS (MD / MF) → Run workflow**. Neither
commits nor file changes launch builds. Download firmware from the
repository's **Releases** page; every prerelease has its own source
commit, per-device checksums and build metadata.

## Hardware acceptance before deployment

1. Boot both variants and verify 2.5GbE `lan1` and Gigabit `lan2..lan4`.
2. Confirm a DHCP lease, HTTPS LuCI, SSH, and four-port bridge behavior.
3. Provision a test `wg0` via UCI/netifd; verify kernel WireGuard handshake.
4. Verify `wg0` → uplink IPv4 forwarding/NAT and blocked unsolicited input.
5. Run sustained throughput, packet-loss, CPU/RSS and restart/recovery tests.
6. Check that disabling PON PCS did not disrupt Ethernet SerDes/PCS.

Do not assume Gigabit WireGuard throughput: measure AN7581 and AN7583
separately. Full kernel builds may exceed standard hosted runner disk/memory
budgets; use a self-hosted Linux runner if necessary.
