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

# ---- build: restore + publish ----
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /build
COPY src/Movies.Api/Movies.Api.csproj src/Movies.Api/
RUN dotnet restore src/Movies.Api/Movies.Api.csproj
COPY src/Movies.Api/ src/Movies.Api/
RUN dotnet publish src/Movies.Api/Movies.Api.csproj -c Release -o /app --no-restore /p:UseAppHost=false

# ---- runtime: what runs on the server (default target) ----
FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS runtime
WORKDIR /app
COPY --from=build /app .

# The aspnet image's non-root "app" user owns /data, so a fresh named volume does too.
RUN mkdir -p /data && chown app:app /data
VOLUME /data

ENV ASPNETCORE_ENVIRONMENT=Production \
    ASPNETCORE_HTTP_PORTS=8080 \
    ConnectionStrings__Movies="Data Source=/data/movies.db" \
    DataProtection__KeysPath=/data/keys \
    DOTNET_CLI_TELEMETRY_OPTOUT=1

USER app
EXPOSE 8080
# Extra args run CLI commands instead of the web server, e.g. `import /data/x.csv` or `create-user raul`.
ENTRYPOINT ["dotnet", "Movies.Api.dll"]
