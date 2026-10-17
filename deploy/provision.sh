#!/usr/bin/env bash
# Complete, idempotent provisioning of a fresh Rocky/Alma/RHEL 9-10 server for movies-webapp.
#
# Normally runs automatically on first boot from the cloud-init file made by build-cloud-init.sh.
# It can also be run by hand from an unpacked bundle:  sudo bash provision.sh
#
#   1. network fix (fix-network.sh)
#   2. admin user with SSH key only, passwordless sudo; root and password SSH logins off
#   3. packages, firewall (SSH only), automatic security updates, Cockpit/rpcbind off (harden-server.sh)
#   4. "movies" service user, quadlets, secrets, registry login, timers, start the app + tunnel (setup-server.sh)
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$DIR/server.conf"   # ADMIN_USER
step() { echo; echo "==> $*"; }

step "Network"
bash "$DIR/fix-network.sh"
for _ in $(seq 1 30); do getent hosts dnf.rockylinux.org >/dev/null 2>&1 && break; sleep 2; done

step "Admin user: $ADMIN_USER"
id "$ADMIN_USER" &>/dev/null || useradd --create-home --groups wheel --shell /bin/bash "$ADMIN_USER"
usermod -aG wheel "$ADMIN_USER"
passwd -l "$ADMIN_USER" >/dev/null
ADMIN_HOME="$(getent passwd "$ADMIN_USER" | cut -d: -f6)"
install -d -o "$ADMIN_USER" -g "$ADMIN_USER" -m 700 "$ADMIN_HOME/.ssh"
touch "$ADMIN_HOME/.ssh/authorized_keys"
grep -qxF "$(cat "$DIR/admin.pub")" "$ADMIN_HOME/.ssh/authorized_keys" || cat "$DIR/admin.pub" >> "$ADMIN_HOME/.ssh/authorized_keys"
chown "$ADMIN_USER:$ADMIN_USER" "$ADMIN_HOME/.ssh/authorized_keys"
chmod 600 "$ADMIN_HOME/.ssh/authorized_keys"
restorecon -R "$ADMIN_HOME/.ssh" 2>/dev/null || true
# Key-only account (no password), so sudo must not prompt.
echo "$ADMIN_USER ALL=(ALL) NOPASSWD:ALL" > "/etc/sudoers.d/90-$ADMIN_USER"
chmod 440 "/etc/sudoers.d/90-$ADMIN_USER"
visudo -cf "/etc/sudoers.d/90-$ADMIN_USER" >/dev/null

step "SSH: key-only, $ADMIN_USER only"
cat > /etc/ssh/sshd_config.d/10-hardening.conf <<CONF
PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
PubkeyAuthentication yes
MaxAuthTries 3
LoginGraceTime 20
X11Forwarding no
AllowUsers $ADMIN_USER
CONF
chmod 600 /etc/ssh/sshd_config.d/10-hardening.conf
sshd -t
systemctl reload sshd

step "Packages, firewall, automatic updates"
bash "$DIR/harden-server.sh"

step "App: service user, containers, tunnel, timers"
bash "$DIR/setup-server.sh" "$DIR"

echo
echo "PROVISION OK"
