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
  `wireguard-tools`, and a small LuCI HTTPS UI (admin/status modules,
  `uhttpd`, `uhttpd-mod-ubus`, and `px5g-mbedtls`).
- **Excluded:** DHCP server, PPPoE, Wi-Fi, PON userspace, VoIP, strongSwan,
  AirRoute Core, userspace WireGuard, TUN and TPROXY modules.
- The upstream NPU/crypto support and necessary PHY/flash drivers are
  intentionally retained pending hardware validation.
- The Nokia common DTS disables PON PCS. Ethernet PCS remains enabled.

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

## Reproducible build

Use a **fresh checkout for each device** on a Linux build host. The source
`main` branch advances rapidly; pin the exact successful source commit for
production releases. The selected official feeds are locked to known
revisions in `airrelay/feeds.conf`.

```sh
cp airrelay/feeds.conf feeds.conf
./scripts/feeds update packages luci
./scripts/feeds install -a -p packages
./scripts/feeds install -a -p luci

bash airrelay/scripts/configure.sh md  # or: mf, in a separate clean checkout
make download -j2
make -j2
bash airrelay/scripts/check-image.sh md
```

`configure.sh` intentionally refuses to overwrite an existing `.config` or
local `files/` overlay. The version-controlled overlay lives in
`airrelay/overlay/`; OpenWrt normally ignores its build-time `files/` folder.

The manual GitHub Actions workflow **AirRelay OS (MD / MF)** builds both
devices. Its artifacts include UBI sysupgrade/recovery images, a package
manifest, build configuration, and image checksums. It does **not** flash
hardware, change bootloaders, or publish to GitHub Releases. GitHub only
exposes `workflow_dispatch` in its Actions UI after the workflow file is
merged into the repository's default branch; reviewing this feature branch
alone does not start a build.

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
