# movies-webapp

Personal film & series collection for **movies.raulblideran.uk**.

- **API:** ASP.NET Core 10 Minimal APIs, EF Core and SQLite.
- **Auth:** ASP.NET Core Identity with users, roles and TOTP two-factor.
- **Front-end:** plain HTML/JS in `src/Movies.Api/wwwroot`. Styles are in `css/site.css` (the default "Picture house" theme). Each film theme is one file in `css/themes/`, plus its hero artwork in `js/theme.js`. Visitors pick a theme from the top bar, and `?theme=<id>` links straight to one. Hero photos: film stills are loaded from TMDB's image server (credited in the footer); the default theme's cinema photos in `wwwroot/img/` are by Eden, Janine and Jim on Wikimedia Commons, CC BY 2.0.

The only thing your machine needs is **podman**. The .NET SDK lives in the dev container.

## Quick start

```bash
./dev.sh                                    # build the image (first time), start the API + site → http://localhost:5080
./dev.sh import data/movies-sheet-export.csv  # one-off: load the collection (CSV export of the old Google Sheet)
./dev.sh create-user raul --role Admin      # create your account (prompts for a password, 12+ chars)
```

Then sign in with **Sign in** in the top bar, or open `http://localhost:5080/?admin`. The first time you sign in you have to set up an authenticator app (Aegis, 2FAS, Google Authenticator…). Save the recovery codes it shows you.

Settings live in `.env.dev`, which is git-ignored and created from `.env.dev.example` on the first run:

| Variable | |
|---|---|
| `Tmdb__ApiKey` | TMDB key, used for the poster search and poster lookup on import |
| `Auth__RequireMfa` | `true` (default): users must enrol 2FA before they can edit anything |

Locally, CeX calls go through the `cex-proxy-movies-dev` proxy on Deno Deploy and the background CeX price jobs are off
(`appsettings.Development.json`), so your home connection never calls CeX's API directly. CeX blocks
addresses that call it a lot, and it blocks a whole home IPv6 range at once.

## dev.sh

| Command | |
|---|---|
| `./dev.sh` / `up` | `dotnet watch` in pod `movies-dev`; hot-reloads C#, HTML and JS |
| `./dev.sh test` | run the test suite |
| `./dev.sh ef migrations add <Name>` | EF Core migrations (applied automatically on startup) |
| `./dev.sh import <file.csv or url> [--replace] [--no-posters]` | import a sheet-format CSV. Dates can be `dd/MM/yyyy` or `MM/yyyy`; month-only dates get a random day in that month |
| `./dev.sh create-user <name> [--role Admin\|Editor]` | create a user from the CLI |
| `./dev.sh shell` / `./dev.sh dotnet …` | shell or any dotnet command inside the container |
| `./dev.sh rebuild` / `down` / `nuke` | rebuild the image; remove the pod; remove the pod **and** data volumes |

If the app is running, these commands `exec` into it; otherwise they run in a throwaway container in the same pod.

**Volumes:**
- `movies-data` → `/data` holds `movies.db` and the cookie/2FA key ring (`/data/keys`).
- `movies-nuget` caches packages.

**Rootless, SELinux-friendly:**
- The repo is mounted with `:z`.
- `--userns=keep-id` keeps the files the container writes (`bin/`, `obj/`, migrations) owned by you.

**VS Code / Rider.** `.devcontainer/devcontainer.json` uses the same image if you want debugger integration.

**Peek at the DB:** `./dev.sh shell` then `sqlite3 /data/movies.db`.

## Users and security

- **Roles.** **Admin** manages titles and users. **Editor** manages titles only. Anyone not signed in can only read.
- **No public sign-up.** Admins add users from **Users** in the top bar, or with `./dev.sh create-user`.
- **Passwords.**
  - Minimum 12 characters.
  - 5 failed attempts lock the account for 15 minutes.
  - Sign-in endpoints are also limited to 10 requests per minute per IP.
- **Two-factor.**
  - Uses TOTP with 10 one-time recovery codes.
  - "Don't ask again on this device" lasts 30 days.
  - From Users, an Admin can reset a user's 2FA, reset their password (a random one is shown once), lock them, or delete them.
- **Cookies.**
  - HttpOnly and `SameSite=Strict`, and Secure outside development.
  - Sessions are re-validated every minute, so locks, role changes and resets apply almost immediately.

## API

| | Auth |
|---|---|
| `GET /api/titles`, `GET /api/titles/{id}` | public |
| `POST /api/titles`, `PUT /api/titles/{id}`, `DELETE /api/titles/{id}` | Editor + 2FA |
| `GET /api/export.csv` | Editor + 2FA; same columns as the old sheet |
| `GET /api/cex/{sku}` | public; server-side CeX lookup, cached 6h (replaces the CORS proxies and Cloudflare worker) |
| `GET /api/tmdb/search?q=&year=&anime=` | Editor + 2FA |
| `GET /api/tmdb/details?link=` | Editor + 2FA; film/series details from a pasted themoviedb.org link (fills the add/edit form) |
| `POST /api/auth/login`, `/login/mfa`, `/logout`, `GET /api/auth/me` | |
| `/api/account/password`, `/api/account/mfa/*` | signed in |
| `/api/users/*` | Admin + 2FA |

## Layout

```
Containerfile, dev.sh           dev environment
src/Movies.Api/
  Program.cs                    DI, Identity, policies, rate limits
  Cli.cs                        import / create-user commands
  Data/                         Title entity, DbContext (Identity tables + Titles), migrations
  Endpoints/                    titles, auth/account, users, CeX/TMDB
  Import/SheetCsv.cs            sheet CSV ⇄ Title
  Services/                     TMDB + CeX clients
  wwwroot/                      index.html, js/app.js (public page), js/auth.js (sign-in, 2FA, users),
                                js/admin.js (edit controls), js/editor.js (the add/edit form),
                                js/datepicker.js (themed date picker), edit.html + js/edit-page.js
                                (/titles/new and /titles/{id}/edit: the form on its own page),
                                manifest.webmanifest + icons/ + sw.js + js/pwa.js + offline.html (installable
                                app; the collection, releases, stats and CeX pages work offline once visited)
tests/Movies.Api.Tests/         CSV parsing + API/auth integration tests
```

## Production (movies.raulblideran.uk)

Runs on an IONOS VPS (Rocky Linux 10). There are **no open web ports**: `cloudflared` keeps an
outbound Cloudflare Tunnel open, and the tunnel's published route sends `movies.raulblideran.uk`
to `http://localhost:8080`.

- **App user:** a dedicated `movies` user (no sudo, no login shell) runs everything with rootless
  podman quadlets (`deploy/quadlet/`).
- **Pod:** the app and `cloudflared` share a pod. The app's filesystem is read-only, apart from the
  `movies-data` volume, which holds the DB and key ring.
- **Updates:** `podman-auto-update` checks GHCR every 2 minutes. GitHub Actions publishes
  `ghcr.io/raulblideran/movies-webapp:latest` on every push to `main`.
- **Backups:** the SQLite DB is backed up nightly to `/home/movies/backups`, keeping 30 days.

Day to day, from this repo (the server address is in `deploy/secrets/host`):

```bash
./deploy/vps.sh status                         # services and timers
./deploy/vps.sh logs [app|tunnel]
./deploy/vps.sh create-user <name> --role Admin
./deploy/vps.sh push-image                     # deploy a local build right now
./deploy/vps.sh update                         # pull the latest GHCR image right now
./deploy/vps.sh backup                         # back up and download to ./backups/
./deploy/vps.sh cex-add <link> [<link> …]      # track CeX products (or paste links on /cex when signed in)
./deploy/vps.sh install                        # re-apply config after editing deploy/ or deploy/secrets/
./deploy/vps.sh restore <backup.db>            # roll the live DB back to a backup
./deploy/vps.sh reset-db                       # back up, then wipe the live DB (titles, users, CeX items)
```

Secrets live in `deploy/secrets/` (git-ignored; see the `*.example` files):
- `app.env`: TMDB key
- `cloudflared.env`: tunnel token
- `ghcr.env`: a **classic** GitHub token with only `read:packages`. Fine-grained tokens can't read
  GHCR. Without it, auto-update is off and you deploy with `push-image`.

### Moving to a new server (or reinstalling this one)

Works on any Rocky / Alma / RHEL 9-10 server. Everything except the data is installed by cloud-init on first boot.

1. **Build the User Data:** `./deploy/build-cloud-init.sh`. This writes `deploy/secrets/cloud-init.yaml`,
   which contains secrets and is git-ignored. If you're reinstalling the same server, run
   `./deploy/vps.sh backup` **first**.
2. **Create or reinstall the server** with that file as its **User Data** (IONOS: Advanced Options → User Data, type
   *Cloud Config*). Set a root password and keep it in Bitwarden; it's only for the provider's console.
3. **Switch over:** `./deploy/migrate.sh <new-ip>`. This:
   - takes a fresh backup from the current server (or uses the newest file in `./backups/`)
   - waits for provisioning to finish
   - restores the database and stops the old server's tunnel
   - points `deploy/vps.sh` at the new server, and checks the public site

On first boot, `provision.sh` (log: `/var/log/movies-provision.log`):
- fixes networking (`fix-network.sh`). IONOS's config targets `ens3`, but the NIC is `ens6`.
- creates the key-only admin user and turns off root and password SSH logins
- installs packages, the firewall (SSH only) and automatic security updates (`harden-server.sh`)
- sets up the `movies` user, quadlets, secrets, the registry login and timers, then pulls the app and starts it
  (`setup-server.sh`)

All of these scripts are idempotent. To re-apply config to a running server, use `./deploy/vps.sh install`.

Signed-in sessions don't carry over to a new server (the cookie key ring isn't migrated), so sign in again
afterwards. Accounts, 2FA and all data do carry over.
