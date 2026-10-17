#!/usr/bin/env bash
# Nightly consistent SQLite backup of the movies DB (runs as the "movies" user). Keeps 30 days.
set -euo pipefail
dest="$HOME/backups"
mkdir -p "$dest"
vol="$(podman volume inspect movies-data --format '{{.Mountpoint}}')"
file="$dest/movies-$(date +%F).db"
# The DB is owned by the container's user; `podman unshare` enters the same user namespace to read it.
podman unshare sqlite3 "$vol/movies.db" ".backup '$file'"
find "$dest" -name 'movies-*.db' -mtime +30 -delete
echo "Backed up to $file"
