#!/usr/bin/env bash
# Run once on the VPS after first boot:  sudo bash harden-server.sh
# Installs packages, enables the firewall (SSH only), automatic security updates, and turns off Cockpit.
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

dnf -y upgrade
echo "Hardening done. Reboot if the kernel was updated: sudo systemctl reboot"
