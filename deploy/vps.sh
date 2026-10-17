#!/usr/bin/env bash
# Manage the production server from your machine.
#
#   ./deploy/vps.sh install          first-time setup / re-apply config (copies deploy files + secrets, runs setup-server.sh)
#   ./deploy/vps.sh push-image       build the image locally and copy it to the server (no registry needed)
#   ./deploy/vps.sh update           pull & restart now (instead of waiting for the 2-minute auto-update)
#   ./deploy/vps.sh status | logs [app|tunnel]
#   ./deploy/vps.sh create-user <name> [--role Admin|Editor]
#   ./deploy/vps.sh delete-user <name>
#   ./deploy/vps.sh import <local.csv> [--replace]
#   ./deploy/vps.sh cex-add <cex-link> [<cex-link> …]   track CeX products on /cex
#   ./deploy/vps.sh backup           run a backup now and download the newest one to ./backups/
#   ./deploy/vps.sh ssh
#
# The server address comes from deploy/secrets/host (e.g. "raul@203.0.113.10").
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOST_FILE="$DIR/secrets/host"
[[ -f "$HOST_FILE" ]] || { echo "Put the server address in deploy/secrets/host, e.g. raul@1.2.3.4" >&2; exit 1; }
HOST="$(tr -d '[:space:]' < "$HOST_FILE")"
IMAGE=ghcr.io/raulblideran/movies-webapp:latest

# Run a command as the "movies" service user.
as_movies() {
    local cmd; printf -v cmd '%q ' "$@"
    ssh "$HOST" "cd / && sudo -u movies XDG_RUNTIME_DIR=/run/user/\$(id -u movies) DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/\$(id -u movies)/bus bash -c 'cd ~ && $cmd'"
}

cmd="${1:-status}"; shift || true
case "$cmd" in
    install)
        for f in app.env cloudflared.env ghcr.env; do
            [[ -f "$DIR/secrets/$f" ]] || { echo "Missing deploy/secrets/$f (see deploy/secrets/*.example)" >&2; exit 1; }
        done
        tmp="$(ssh "$HOST" mktemp -d)"
        tar -C "$DIR" -czf - quadlet secrets/app.env secrets/cloudflared.env secrets/ghcr.env backup.sh \
            movies-backup.service movies-backup.timer podman-auto-update.timer.conf setup-server.sh \
            | ssh "$HOST" "tar -C $tmp -xzf -"
        ssh -t "$HOST" "sudo bash $tmp/setup-server.sh $tmp; rc=\$?; rm -rf $tmp; exit \$rc"
        ;;
    push-image)
        cd "$DIR/.."
        podman build --target runtime -t "$IMAGE" -f Containerfile .
        podman save "$IMAGE" | gzip -1 | ssh "$HOST" "cd / && gunzip | sudo -u movies XDG_RUNTIME_DIR=/run/user/\$(id -u movies) podman load"
        as_movies systemctl --user restart movies-app.service
        echo "Deployed local build."
        ;;
    update)
        as_movies podman auto-update
        ;;
    status)
        as_movies systemctl --user --no-pager status movies-app.service cloudflared.service podman-auto-update.timer movies-backup.timer | grep -E "●|Active:|Trigger:" || true
        ;;
    logs)
        unit=movies-app; [[ "${1:-app}" == tunnel ]] && unit=cloudflared
        as_movies journalctl --user -u "$unit" -n 100 --no-pager
        ;;
    create-user)
        # Password is read from your terminal and piped over SSH (never stored or put on a command line).
        read -rsp "Password for $1: " pw; echo
        printf '%s\n' "$pw" | ssh "$HOST" "cd / && sudo -u movies XDG_RUNTIME_DIR=/run/user/\$(id -u movies) podman run --rm -i --read-only -v movies-data:/data $IMAGE create-user $(printf '%q ' "$@")"
        ;;
    delete-user)
        name="${1:?usage: delete-user <name>}"
        [[ "$name" =~ ^[A-Za-z0-9._@+-]+$ ]] || { echo "Unexpected characters in username" >&2; exit 1; }
        read -rp "Delete user '$name' from the live site? [y/N] " ok
        [[ "$ok" == [yY] ]] || exit 1
        # Identity's tables cascade from AspNetUsers (roles, tokens, recovery codes, logins).
        sql="PRAGMA foreign_keys=ON; DELETE FROM AspNetUsers WHERE NormalizedUserName = upper('$name'); SELECT changes() || ' user(s) deleted';"
        ssh "$HOST" "cd / && sudo -u movies XDG_RUNTIME_DIR=/run/user/\$(id -u movies) bash -c 'cd ~ && podman unshare sqlite3 \$(podman volume inspect movies-data --format {{.Mountpoint}})/movies.db'" <<< "$sql"
        ;;
    import)
        file="$1"; shift
        # Hand the file to the movies user so SELinux can label it for the container.
        ssh "$HOST" "cd / && sudo install -o movies -g movies -m 644 /dev/stdin /home/movies/import.csv" < "$file"
        ssh "$HOST" "cd / && sudo -u movies XDG_RUNTIME_DIR=/run/user/\$(id -u movies) podman run --rm --read-only -v movies-data:/data -v /home/movies/import.csv:/import.csv:ro,z --env-file /home/movies/.config/movies/app.env $IMAGE import /import.csv $(printf '%q ' "$@"); sudo rm -f /home/movies/import.csv"
        ;;
    cex-add)
        ssh "$HOST" "cd / && sudo -u movies XDG_RUNTIME_DIR=/run/user/\$(id -u movies) podman run --rm --read-only -v movies-data:/data --env-file /home/movies/.config/movies/app.env $IMAGE cex-add $(printf '%q ' "$@")"
        ;;
    backup)
        as_movies movies-backup
        mkdir -p backups
        latest="$(ssh "$HOST" "sudo ls -1t /home/movies/backups | head -1")"
        ssh "$HOST" "sudo cat /home/movies/backups/$latest" > "backups/$latest"
        echo "Downloaded backups/$latest"
        ;;
    ssh)
        exec ssh "$HOST"
        ;;
    *)
        sed -n '2,14p' "$0"; exit 1 ;;
esac
