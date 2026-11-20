#!/usr/bin/env bash
# One-time setup of a fresh Hetzner Cloud server (Ubuntu 24.04) for Neon Velocity. Run as root:
#   ssh root@SERVER 'bash -s' < deploy/setup-server.sh
# Installs Node 24, Caddy (web server with automatic HTTPS), sqlite3; creates the 'neonvel' service user,
# folders, the systemd service, a firewall (SSH + web only), automatic security updates and nightly backups.
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

apt-get update -y
apt-get upgrade -y
apt-get install -y curl ca-certificates gnupg ufw sqlite3 unattended-upgrades debian-keyring debian-archive-keyring apt-transport-https

# Node.js 24 (NodeSource)
if ! command -v node >/dev/null || ! node -v | grep -q '^v24'; then
  curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
  apt-get install -y nodejs
fi

# Caddy (official repository)
if ! command -v caddy >/dev/null; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y
  apt-get install -y caddy
fi

# Service user and folders: /srv/neonvel/app (server code), /srv/neonvel/www (the game), /srv/neonvel/data (db)
id neonvel >/dev/null 2>&1 || useradd --system --home /srv/neonvel --shell /usr/sbin/nologin neonvel
mkdir -p /srv/neonvel/app /srv/neonvel/www /srv/neonvel/data /var/backups/neonvel
chown -R neonvel:neonvel /srv/neonvel/data /var/backups/neonvel
chmod 750 /srv/neonvel/data /var/backups/neonvel

# Secrets / settings live in /etc/neonvel.env (created empty here; fill it in, see deploy/neonvel.env.example)
[ -f /etc/neonvel.env ] || install -m 600 /dev/null /etc/neonvel.env

cat > /etc/systemd/system/neonvel.service <<'UNIT'
[Unit]
Description=Neon Velocity game server
After=network-online.target
Wants=network-online.target

[Service]
User=neonvel
WorkingDirectory=/srv/neonvel/app
EnvironmentFile=/etc/neonvel.env
Environment=PORT=8787
Environment=DB_PATH=/srv/neonvel/data/neon.db
ExecStart=/usr/bin/node server/index.ts
Restart=always
RestartSec=2
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/srv/neonvel/data
PrivateTmp=true

[Install]
WantedBy=multi-user.target
UNIT

# Nightly database backup (03:30): a consistent copy via sqlite's online backup, compressed, kept 30 days.
cat > /usr/local/bin/neonvel-backup <<'BK'
#!/usr/bin/env bash
set -euo pipefail
src=/srv/neonvel/data/neon.db
[ -f "$src" ] || exit 0
out=/var/backups/neonvel/neon-$(date +%Y%m%d-%H%M).db
sqlite3 "$src" ".backup '$out'"
gzip -f "$out"
find /var/backups/neonvel -name 'neon-*.db.gz' -mtime +30 -delete
BK
chmod 755 /usr/local/bin/neonvel-backup
cat > /etc/cron.d/neonvel-backup <<'CR'
30 3 * * * neonvel /usr/local/bin/neonvel-backup
CR

# Firewall: SSH and web only (the game server port 8787 stays internal, Caddy passes traffic on).
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

systemctl daemon-reload
systemctl enable neonvel
echo "Setup done. Next: fill /etc/neonvel.env, put the Caddyfile in place and deploy (deploy/deploy.sh)."
