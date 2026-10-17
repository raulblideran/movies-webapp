#!/usr/bin/env bash
# Packages, firewall (SSH only), automatic security updates, Cockpit and rpcbind off. Idempotent.
# Called by provision.sh; can also be run alone:  sudo bash harden-server.sh
set -euxo pipefail

dnf -y install podman firewalld dnf-automatic sqlite tar
systemctl enable --now firewalld
# Allow SSH before anything else so we can't lock ourselves out.
firewall-cmd --permanent --add-service=ssh
firewall-cmd --permanent --remove-service=cockpit || true
firewall-cmd --permanent --remove-service=dhcpv6-client || true
firewall-cmd --reload
firewall-cmd --list-all

sed -i 's/^upgrade_type.*/upgrade_type = security/; s/^apply_updates.*/apply_updates = yes/' /etc/dnf/automatic.conf
systemctl enable --now dnf-automatic.timer
systemctl disable --now cockpit.socket || true
# Pulled in by updates; nothing here needs RPC.
systemctl disable --now rpcbind.service rpcbind.socket 2>/dev/null || true

dnf -y upgrade
systemctl disable --now rpcbind.service rpcbind.socket 2>/dev/null || true
echo "Hardening done."
