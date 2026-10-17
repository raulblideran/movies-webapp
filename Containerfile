# syntax=docker/dockerfile:1

# ---- dev: SDK + tools, source is bind-mounted at /src by dev.sh ----
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS dev

RUN apt-get update \
    && apt-get install -y --no-install-recommends sqlite3 \
    && rm -rf /var/lib/apt/lists/*

ENV DOTNET_CLI_TELEMETRY_OPTOUT=1 \
    DOTNET_NOLOGO=1 \
    DOTNET_USE_POLLING_FILE_WATCHER=true \
    DOTNET_WATCH_RESTART_ON_RUDE_EDIT=1 \
    ASPNETCORE_ENVIRONMENT=Development \
    ASPNETCORE_URLS=http://0.0.0.0:5080 \
    ASPNETCORE_HTTP_PORTS= \
    HOME=/home/dev \
    DOTNET_CLI_HOME=/home/dev \
    NUGET_PACKAGES=/home/dev/.nuget/packages \
    PATH="/opt/dotnet-tools:${PATH}"

RUN dotnet tool install dotnet-ef --tool-path /opt/dotnet-tools \
    # dev.sh runs the container as the host user (--userns=keep-id), so these
    # must be writable by any uid; named volumes inherit these permissions.
    && mkdir -p /home/dev/.nuget/packages /data \
    && chmod -R 0777 /home/dev /data

WORKDIR /src
EXPOSE 5080
CMD ["dotnet", "watch", "--project", "src/Movies.Api", "--non-interactive"]
