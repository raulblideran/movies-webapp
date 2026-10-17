#!/usr/bin/env bash
# One-time (idempotent) server setup. Run on the VPS as root:  sudo bash setup-server.sh <dir-with-deploy-files>
# Expects in <dir>: quadlet/*, backup.sh, movies-backup.{service,timer}, podman-auto-update.timer.conf,
# and secrets/{app.env,cloudflared.env,ghcr.env}.
set -euo pipefail
SRC="${1:?usage: setup-server.sh <deploy-dir>}"
cd /
U=movies

if ! id "$U" &>/dev/null; then
    useradd --create-home --shell /sbin/nologin "$U"
    echo "Created user $U"
fi
loginctl enable-linger "$U"
UID_N="$(id -u "$U")"
HOME_D="$(getent passwd "$U" | cut -d: -f6)"
as_u() { sudo -u "$U" XDG_RUNTIME_DIR="/run/user/$UID_N" DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/$UID_N/bus" "$@"; }

# Wait for the user's systemd instance (started by linger).
for _ in $(seq 1 30); do [[ -S "/run/user/$UID_N/bus" ]] && break; sleep 1; done

install -d -o "$U" -g "$U" -m 700 "$HOME_D/.config" "$HOME_D/.config/movies" "$HOME_D/.config/containers" \
    "$HOME_D/.config/containers/systemd" "$HOME_D/.config/systemd/user" \
    "$HOME_D/.config/systemd/user/podman-auto-update.timer.d" "$HOME_D/.local" "$HOME_D/.local/bin" "$HOME_D/backups"

install -o "$U" -g "$U" -m 644 "$SRC"/quadlet/* "$HOME_D/.config/containers/systemd/"
install -o "$U" -g "$U" -m 600 "$SRC/secrets/app.env" "$SRC/secrets/cloudflared.env" "$HOME_D/.config/movies/"
install -o "$U" -g "$U" -m 755 "$SRC/backup.sh" "$HOME_D/.local/bin/movies-backup"
install -o "$U" -g "$U" -m 644 "$SRC/movies-backup.service" "$SRC/movies-backup.timer" "$HOME_D/.config/systemd/user/"
install -o "$U" -g "$U" -m 644 "$SRC/podman-auto-update.timer.conf" "$HOME_D/.config/systemd/user/podman-auto-update.timer.d/override.conf"

# Registry login for the private image (token needs read:packages). Stored in the user's config dir so it survives reboots.
# shellcheck disable=SC1091
source "$SRC/secrets/ghcr.env"
if [[ -n "${GHCR_TOKEN:-}" ]]; then
    printf '%s' "$GHCR_TOKEN" | as_u podman login ghcr.io --username "$GHCR_USER" --password-stdin \
        --authfile "$HOME_D/.config/containers/auth.json"
else
    echo "No GHCR_TOKEN: skipping registry login (load images with ./deploy/vps.sh push-image)."
fi

as_u systemctl --user daemon-reload
as_u systemctl --user enable --now podman-auto-update.timer movies-backup.timer
if [[ -n "${GHCR_TOKEN:-}" ]]; then
    as_u podman pull ghcr.io/raulblideran/movies-webapp:latest
fi
if as_u podman image exists ghcr.io/raulblideran/movies-webapp:latest; then
    as_u systemctl --user restart movies-app.service cloudflared.service
else
    as_u systemctl --user restart cloudflared.service
    echo "App image not on the server yet: run ./deploy/vps.sh push-image"
fi
sleep 5
as_u systemctl --user --no-pager status movies-app.service cloudflared.service | grep -E "●|Active:"
echo "Setup complete."
