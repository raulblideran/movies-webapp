#!/usr/bin/env bash
# Portable dev environment for movies-webapp. Only requires podman on the host.
#
#   ./dev.sh [up]                 build image if needed, start pod, run `dotnet watch` (API + front-end on :5080)
#   ./dev.sh shell                bash in the dev container
#   ./dev.sh test                 dotnet test
#   ./dev.sh ef <args>            dotnet ef <args> against src/Movies.Api   (e.g. ./dev.sh ef migrations add Foo)
#   ./dev.sh import <csv|url>     import titles from a CSV file (repo-relative) or published Google Sheet URL
#   ./dev.sh create-user <name> [--role Admin|Editor]
#   ./dev.sh dotnet <args>        any dotnet command
#   ./dev.sh rebuild              rebuild the dev image
#   ./dev.sh down                 remove pod + containers (keeps volumes: DB and NuGet cache)
#   ./dev.sh nuke                 down + remove volumes (deletes the dev database!)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
IMAGE="localhost/movies-webapp-dev:latest"
POD="movies-dev"
APP="movies-dev-app"
PORT="${PORT:-5080}"
ENV_FILE="$ROOT/.env.dev"

command -v podman >/dev/null || { echo "podman is required" >&2; exit 1; }

ensure_env() {
    if [[ ! -f "$ENV_FILE" ]]; then
        cp "$ROOT/.env.dev.example" "$ENV_FILE"
        echo "Created .env.dev from .env.dev.example (add your TMDB key there)."
    fi
}

ensure_image() {
    if [[ "${1:-}" == "--force" ]] || ! podman image exists "$IMAGE"; then
        podman build --target dev -t "$IMAGE" -f "$ROOT/Containerfile" "$ROOT"
    fi
}

ensure_pod() {
    if ! podman pod exists "$POD"; then
        # keep-id: processes run as your host uid, so files written to the bind mount stay yours.
        podman pod create --name "$POD" --userns=keep-id -p "127.0.0.1:${PORT}:5080" >/dev/null
    fi
}

app_running() {
    [[ "$(podman container inspect -f '{{.State.Running}}' "$APP" 2>/dev/null || echo false)" == "true" ]]
}

common_args() {
    printf '%s\n' \
        --pod "$POD" \
        -v "$ROOT:/src:z" \
        -v movies-nuget:/home/dev/.nuget \
        -v movies-data:/data \
        --env-file "$ENV_FILE" \
        -e "ConnectionStrings__Movies=Data Source=/data/movies.db" \
        -e "DataProtection__KeysPath=/data/keys" \
        -w /src
}

# Run a command in the dev environment. If the app container is already running,
# exec into it so we don't fight `dotnet watch` over bin/obj.
in_dev() {
    ensure_env; ensure_image; ensure_pod
    local tty=(-i)
    [[ -t 0 && -t 1 ]] && tty=(-it)
    if app_running; then
        podman exec "${tty[@]}" -w /src "$APP" "$@"
    else
        local args; mapfile -t args < <(common_args)
        podman run --rm "${tty[@]}" "${args[@]}" "$IMAGE" "$@"
    fi
}

cmd="${1:-up}"; shift || true
case "$cmd" in
    up)
        ensure_env; ensure_image; ensure_pod
        if app_running; then
            echo "Already running → http://localhost:${PORT}  (attaching to logs, Ctrl+C detaches)"
            exec podman logs -f "$APP"
        fi
        podman rm -f "$APP" >/dev/null 2>&1 || true
        mapfile -t args < <(common_args)
        echo "Starting → http://localhost:${PORT}  (Ctrl+C to stop)"
        tty=(); [[ -t 0 && -t 1 ]] && tty=(-it)
        exec podman run --rm --init "${tty[@]}" --name "$APP" "${args[@]}" "$IMAGE" \
            dotnet watch --project src/Movies.Api --non-interactive
        ;;
    shell)        in_dev bash ;;
    test)         in_dev dotnet test "$@" ;;
    ef)           in_dev dotnet ef "$@" --project src/Movies.Api ;;
    import)
        # dotnet run executes from the project dir, so turn repo-relative file paths into container paths.
        args=()
        for a in "$@"; do
            if [[ -f "$ROOT/$a" ]]; then args+=("/src/$a"); else args+=("$a"); fi
        done
        in_dev dotnet run --project src/Movies.Api -- import "${args[@]}" ;;
    create-user)  in_dev dotnet run --project src/Movies.Api -- create-user "$@" ;;
    dotnet)       in_dev dotnet "$@" ;;
    rebuild)      ensure_image --force ;;
    down)
        podman pod rm -f "$POD" >/dev/null 2>&1 || true
        echo "Pod removed (volumes kept)."
        ;;
    nuke)
        podman pod rm -f "$POD" >/dev/null 2>&1 || true
        podman volume rm -f movies-nuget movies-data >/dev/null 2>&1 || true
        echo "Pod and volumes removed."
        ;;
    *)
        sed -n '2,15p' "$0"; exit 1 ;;
esac
