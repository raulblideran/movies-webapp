#!/usr/bin/env bash
# Give every Ethernet card without an IPv4 address a DHCP profile, and stop cloud-init
# from managing the network. IONOS ships network config for "ens3"/"eth*" but the VPS's
# card is "ens6", which left the server with no IPv4 on first boot. Harmless when the
# network already works. Runs from cloud-init bootcmd and again from provision.sh.
command -v nmcli >/dev/null || exit 0
for dev in $(nmcli -t -f DEVICE,TYPE device | awk -F: '$2 == "ethernet" { print $1 }'); do
    if ip -4 addr show dev "$dev" | grep -q "inet "; then continue; fi
    if ! nmcli -t -f NAME connection show | grep -qx "$dev"; then
        nmcli connection add type ethernet ifname "$dev" con-name "$dev" \
            ipv4.method auto ipv6.method auto connection.autoconnect-priority 100 >/dev/null
    fi
    nmcli connection up "$dev" >/dev/null 2>&1 || true
done
mkdir -p /etc/cloud/cloud.cfg.d
echo "network: {config: disabled}" > /etc/cloud/cloud.cfg.d/99-disable-network-config.cfg
