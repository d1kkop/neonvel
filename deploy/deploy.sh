#!/usr/bin/env bash
# Build the game and push it to the server, then restart the game server. Run from the project folder:
#   deploy/deploy.sh root@SERVER            (or set NEONVEL_HOST=root@SERVER)
set -euo pipefail
host="${1:-${NEONVEL_HOST:?usage: deploy/deploy.sh root@SERVER}}"
key="${NEONVEL_KEY:-$HOME/.ssh/neonvel_hetzner}"
ssh_="ssh -i $key -o StrictHostKeyChecking=accept-new $host"
cd "$(dirname "$0")/.."

npm run build
# The game (static files)
tar -C dist -czf - . | $ssh_ 'rm -rf /srv/neonvel/www.new && mkdir -p /srv/neonvel/www.new && tar -xzf - -C /srv/neonvel/www.new && rm -rf /srv/neonvel/www.old && mv /srv/neonvel/www /srv/neonvel/www.old && mv /srv/neonvel/www.new /srv/neonvel/www'
# The server code (it imports a few shared files from src/)
tar -czf - server/index.ts src package.json package-lock.json --exclude='server/*.db*' | $ssh_ 'tar -xzf - -C /srv/neonvel/app && cd /srv/neonvel/app && npm ci --omit=dev --no-audit --no-fund && systemctl restart neonvel && sleep 1 && systemctl --no-pager --lines=5 status neonvel'
echo "Deployed."
