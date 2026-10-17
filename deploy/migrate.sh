#!/usr/bin/env bash
# Move production to a new server that was installed with the User Data from build-cloud-init.sh.
#
#   ./deploy/migrate.sh <new-ip> [backup.db]
#
# 1. takes a fresh backup from the current server (or uses the given file / newest ./backups/*.db)
# 2. waits for the new server's first-boot provisioning to finish
# 3. restores the database there and checks the app is up
# 4. stops the old server's app and tunnel, so Cloudflare only routes to the new one
# 5. points deploy/vps.sh at the new server and checks the public site
#
# Reinstalling the SAME server? Run ./deploy/vps.sh backup BEFORE reinstalling; this script then
# uses that file from ./backups/.
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR/.."
NEW_IP="${1:?usage: migrate.sh <new-ip> [backup.db]}"
ADMIN_USER="${ADMIN_USER:-raul}"
NEW="$ADMIN_USER@$NEW_IP"
OLD="$(tr -d '[:space:]' < "$DIR/secrets/host" 2>/dev/null || true)"
SITE="https://movies.raulblideran.uk"
say() { echo; echo "==> $*"; }

# ---- 1. backup ----
backup="${2:-}"
if [[ -z "$backup" && -n "$OLD" && "${OLD#*@}" != "$NEW_IP" ]] && ssh -o BatchMode=yes -o ConnectTimeout=10 "$OLD" true 2>/dev/null; then
    say "Backing up the current server ($OLD)"
    ./deploy/vps.sh backup
fi
if [[ -z "$backup" ]]; then
    backup="$(ls -1t backups/movies-*.db 2>/dev/null | head -1 || true)"
fi
if [[ -z "$backup" ]]; then
    read -rp "No backup found. Continue with an EMPTY database? [y/N] " ok
    [[ "$ok" == [yY] ]] || exit 1
else
    age_h=$(( ($(date +%s) - $(stat -c %Y "$backup")) / 3600 ))
    say "Using backup $backup (${age_h}h old)"
    if (( age_h > 24 )); then
        read -rp "That backup is over a day old. Use it anyway? [y/N] " ok
        [[ "$ok" == [yY] ]] || exit 1
    fi
fi

# ---- 2. wait for provisioning ----
say "Waiting for SSH on $NEW (first boot can take 5-10 minutes)"
ssh-keygen -R "$NEW_IP" >/dev/null 2>&1 || true
for i in $(seq 1 120); do
    ssh -o BatchMode=yes -o ConnectTimeout=5 -o StrictHostKeyChecking=accept-new "$NEW" true 2>/dev/null && break
    (( i == 120 )) && { echo "No SSH after 20 minutes. Check the provider's console (is there an IPv4 address?)." >&2; exit 1; }
    sleep 10
done
say "Waiting for provisioning to finish"
for i in $(seq 1 120); do
    state="$(ssh "$NEW" 'if sudo grep -q "^PROVISION OK" /var/log/movies-provision.log 2>/dev/null; then echo ok;
        elif cloud-init status 2>/dev/null | grep -qE "status: (done|error)"; then echo failed; else echo running; fi')"
    [[ "$state" == ok ]] && break
    if [[ "$state" == failed || $i == 120 ]]; then
        echo "Provisioning did not finish. Last lines of /var/log/movies-provision.log:" >&2
        ssh "$NEW" 'sudo tail -30 /var/log/movies-provision.log' >&2 || true
        exit 1
    fi
    sleep 10
done
echo "Provisioned."

# ---- 3. restore ----
if [[ -n "$backup" ]]; then
    say "Restoring the database on the new server"
    VPS_HOST="$NEW" ./deploy/vps.sh restore "$backup"
fi
sleep 5
VPS_HOST="$NEW" ./deploy/vps.sh status

# ---- 4. retire the old server's app ----
if [[ -n "$OLD" && "${OLD#*@}" != "$NEW_IP" ]] && ssh -o BatchMode=yes -o ConnectTimeout=10 "$OLD" true 2>/dev/null; then
    say "Stopping the app and tunnel on the old server ($OLD)"
    ssh "$OLD" 'cd / && sudo -u movies XDG_RUNTIME_DIR=/run/user/$(id -u movies) DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/$(id -u movies)/bus bash -c "
        systemctl --user stop cloudflared.service movies-app.service movies-pod.service podman-auto-update.timer movies-backup.timer || true
        cd ~/.config/containers && [ -d systemd ] && mv systemd systemd.retired; systemctl --user daemon-reload"' || true
fi

# ---- 5. switch over ----
echo "$NEW" > "$DIR/secrets/host"
say "deploy/vps.sh now manages $NEW"
sleep 10
titles="$(curl -s "$SITE/api/titles" | python3 -c 'import json,sys; print(len(json.load(sys.stdin)))' 2>/dev/null || echo "?")"
echo "Public site: $(curl -s -o /dev/null -w '%{http_code}' "$SITE/") · titles: $titles · version: $(curl -s "$SITE/api/version")"
echo "Done. Once you're happy, delete the old server."
