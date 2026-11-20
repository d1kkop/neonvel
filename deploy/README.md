# Deploying Neon Velocity (Hetzner Cloud + Caddy)

One small Ubuntu 24.04 server runs everything: Caddy serves the game over HTTPS and passes `/ws`, `/auth`,
`/store`, `/stripe`, `/laptimes` and `/leaderboard` on to the Node game server (port 8787, not exposed).

1. Create the server (Hetzner Cloud, Ubuntu 24.04, EU location) with the SSH key `~/.ssh/neonvel_hetzner.pub`.
2. Point the domain's A record at the server's IPv4 address.
3. `ssh -i ~/.ssh/neonvel_hetzner root@SERVER 'bash -s' < deploy/setup-server.sh`
4. Copy `deploy/Caddyfile` to `/etc/caddy/Caddyfile` (domain filled in), `systemctl reload caddy`.
5. Fill `/etc/neonvel.env` (see `neonvel.env.example`).
6. `deploy/deploy.sh root@SERVER` — builds, uploads, restarts. Run it again for every update.

Backups: nightly at 03:30 to `/var/backups/neonvel/neon-*.db.gz`, kept 30 days (`/usr/local/bin/neonvel-backup`).
Logs: `journalctl -u neonvel -f`.
