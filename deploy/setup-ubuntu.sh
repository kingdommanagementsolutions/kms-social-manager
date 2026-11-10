#!/usr/bin/env bash
# Installs Node.js 22, git and nginx (HTTP on the server's IP, no domain) on Ubuntu 24.04. Run on the server: sudo deploy/setup-ubuntu.sh
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

apt-get update -qq
apt-get install -y -qq nodejs nginx

# nginx: serve the app on port 80 for any host/IP
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
install -m 0644 "$HERE/nginx.conf" /etc/nginx/sites-available/kms-social
ln -sf /etc/nginx/sites-available/kms-social /etc/nginx/sites-enabled/kms-social
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl enable --now nginx
systemctl reload nginx

# Let web traffic in if the firewall is on
if command -v ufw >/dev/null && ufw status | grep -q "Status: active"; then ufw allow OpenSSH >/dev/null; ufw allow 80/tcp >/dev/null; echo "ufw: opened 80"; fi

echo; echo "node $(node -v) | npm $(npm -v) | $(git --version) | nginx $(nginx -v 2>&1 | cut -d/ -f2)"

IP="$(hostname -I | awk '{print $1}')"
echo "Next: deploy/deploy.sh local <branch>, then set BASE_URL=http://$IP/kms-social-dashboard in /opt/kms-social-manager/.env"
