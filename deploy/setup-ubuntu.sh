#!/usr/bin/env bash
# Installs Node.js 22, git and Caddy on Ubuntu 24.04. Run on the server: sudo deploy/setup-ubuntu.sh
set -euo pipefail
[ "$(id -u)" -eq 0 ] || { echo "Run with sudo"; exit 1; }
. /etc/os-release
[ "${VERSION_ID:-}" = "24.04" ] || echo "Warning: written for Ubuntu 24.04, found ${PRETTY_NAME:-unknown}"
export DEBIAN_FRONTEND=noninteractive

apt-get update -qq
apt-get install -y -qq curl gpg git ca-certificates apt-transport-https debian-keyring debian-archive-keyring

# Node.js 22 (NodeSource)
install -d -m 0755 /usr/share/keyrings
curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor --yes -o /usr/share/keyrings/nodesource.gpg
echo "deb [signed-by=/usr/share/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main" > /etc/apt/sources.list.d/nodesource.list

# Caddy (official repo)
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' -o /etc/apt/sources.list.d/caddy-stable.list

apt-get update -qq
apt-get install -y -qq nodejs caddy

# Let web traffic in if the firewall is on
if command -v ufw >/dev/null && ufw status | grep -q "Status: active"; then ufw allow OpenSSH >/dev/null; ufw allow 80,443/tcp >/dev/null; echo "ufw: opened 80/443"; fi

echo; echo "node $(node -v) | npm $(npm -v) | $(git --version) | $(caddy version | head -1)"
