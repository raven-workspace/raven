# Raven: Network section (tunnels and hops) — design

> **Frozen record, shipped** (written 2026-11-11). This spec records the decisions and reasoning at the time. For how Raven works now, read `PRODUCT.md`, `DESIGN.md` and the code; where this spec and the app differ, the app wins.

Shaped 2026-11-11 with the owner (impeccable `shape`). Confirmed.

## Problem

Tunnels and hops are listed and edited only at the very bottom of the Engagement checklist. You can go a whole engagement without discovering them. Two moments matter to the owner:

1. **"How did I get here?"** Get your bearings on the attack path (Kali → A → B) mid-engagement and before reporting.
2. **The dual-homed nudge.** Right after owning a host that can reach a subnet you can't reach yet, Raven says it needs a tunnel.

Not wanted: a status-strip tunnel chip ("is it still up?" was not a real moment).

## Job and audience

The owner, mid-engagement, often in a time-limited exam, with ADHD/autism: an orientation glance, zero friction. Mode: Operate.

## Section

- New sidebar section **Network**, between Findings and Engagement checklist. Number keys: Board 1 · Log 2 · Credentials 3 · Findings 4 · **Network 5** · Engagement checklist 6 · Report 7.
- The Tunnels and Hops panels leave the Engagement checklist. The Lateral movement goals (pivot setup commands per dual-homed host) stay there; a one-line link points to Network.

## The path view

- Reads left to right. **Kali** is the root. Hosts sit in columns by hop depth.
- **Hops** are the edges, labelled with `via` (creds, exploit, share…). Clicking an edge edits the hop; deletion lives in that dialog.
- **Tunnels** are badges on their pivot host: kind, subnets, up/down (down in warn), callback IP. Clicking a badge edits the tunnel; deletion lives in that dialog.
- **Unreached hosts** sit in a dimmed "Not reached" tray.
- **Dual-homed hosts with no tunnel through them** carry a "Needs tunnel" marker that opens Add tunnel prefilled with that host.
- Clicking a host name opens the host page.
- Header actions: Add hop, Add tunnel. Hops are still also created from the foothold tick on the host checklist.
- **Empty:** Kali alone plus "Your first foothold records your first hop."
- **Ranges:** exam ≈ 6 hosts; PEN-200 challenge labs 15–20 hosts and 2–3 tunnels. Must read well at window widths 1,000–1,400 px (owner's WKWebView). When the tree does not fit, the same data shows as an indented ordered list.
- **Anti-goals:** pan/zoom, a network-diagram-tool look, any new dependency.

## Dual-homed nudge: detect, then ask

- When a host's logged command output contains interface listings (`ip a`, `ifconfig`, `ipconfig`), Raven reads its IPv4 interfaces.
- **Always ignored:** loopback (127.0.0.0/8, `lo`), link-local (169.254.0.0/16), 0.0.0.0, all IPv6.
- **Virtual** (`docker*`, `br-*`, `veth*`, `virbr*`, `vmnet*`, `vboxnet*`, `lxcbr*`, `lxdbr*`, `podman*`, `cni*`, `flannel*`, `cali*`, `tun*`, `tap*`, `wg*`, `tailscale*`, `zt*`, Windows adapters named vEthernet / VMware / VirtualBox / Hyper-V / Loopback / Bluetooth): never nudge; shown as one quiet line on the host: "Also seen: docker0 172.17.0.1/16 (virtual)".
- **No nudge** for the subnet the host is reached on (contains the host's IP), for subnets an existing tunnel covers, or for dismissed host+subnet pairs. No host IP → no nudges.
- Everything else: on the host page, "eth1 172.16.5.10/24 reaches 172.16.5.0/24." with **Mark dual-homed and add tunnel** (just **Add tunnel** if already dual-homed). Accepting marks the host dual-homed and opens the tunnel form prefilled (via this host, that subnet). Dismissing is remembered per host + subnet.
- The manual dual-homed toggle in the host dialog stays.

## Links in

- The "via tunnel on X" chip on checklist steps links to Network, focused on X.
- The stuck view's "dual-homed, no tunnel recorded" line links to Network, focused on that host.

## Out of scope

Report figure of the path (phase 3). Changes to command filling through tunnels. Status-strip chip.
