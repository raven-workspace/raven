//! tun0's IPv4 address, for the status bar's LHOST check (design §1.5): when the VPN's address differs from
//! Settings → Your IP, the LHOST cell turns amber and offers to use it. Read-only and local: it asks the OS
//! for one interface's address and makes no network call. No tun0 (no VPN up, or macOS, where VPNs use utunN)
//! is `None`, and the cell doesn't change.

use std::process::Command;

/// tun0's first IPv4 address, or `None` when there is no tun0 or it has no IPv4 address.
pub fn address() -> Option<String> {
    // Fixed programs and arguments: nothing from the page reaches the command line.
    let out = if cfg!(target_os = "linux") {
        Command::new("ip").args(["-4", "-o", "addr", "show", "dev", "tun0"]).output()
    } else {
        Command::new("ifconfig").arg("tun0").output()
    }
    .ok()?;
    if !out.status.success() {
        return None;
    }
    parse(&String::from_utf8_lossy(&out.stdout))
}

/// The first `inet` address in `ip -o addr` or `ifconfig` output: `inet 10.10.14.7/23 …` or `inet 10.10.14.7 netmask …`.
fn parse(text: &str) -> Option<String> {
    let mut words = text.split_whitespace();
    while let Some(w) = words.next() {
        if w == "inet" {
            let addr = words.next()?.split('/').next()?;
            return addr.parse::<std::net::Ipv4Addr>().ok().map(|a| a.to_string());
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_ip_o_addr_output() {
        let line = "5: tun0    inet 10.10.14.7/23 scope global tun0\\       valid_lft forever preferred_lft forever\n";
        assert_eq!(parse(line).as_deref(), Some("10.10.14.7"));
    }

    #[test]
    fn reads_ifconfig_output() {
        let text = "tun0: flags=8051<UP,POINTOPOINT,RUNNING,MULTICAST> mtu 1500\n\tinet 10.10.14.7 --> 10.10.14.1 netmask 0xfffffe00\n";
        assert_eq!(parse(text).as_deref(), Some("10.10.14.7"));
    }

    #[test]
    fn no_inet_line_is_none() {
        assert_eq!(parse(""), None);
        assert_eq!(parse("tun0: flags=8051<UP> mtu 1500\n\tinet6 fe80::1 prefixlen 64\n"), None);
        assert_eq!(parse("inet not-an-address"), None);
    }
}
