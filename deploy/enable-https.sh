#!/usr/bin/env bash
# Gets a free Let's Encrypt certificate and switches the app to HTTPS.
# Usage: sudo deploy/enable-https.sh your.domain.com you@example.com
# Needs: an A record for the domain pointing at this server, and ports 80 and 443 open to the internet.
set -euo pipefail
[ "$(id -u)" -eq 0 ] || { echo "Run with sudo"; exit 1; }
DOMAIN="${1:?usage: enable-https.sh <domain> <email>}"
EMAIL="${2:?usage: enable-https.sh <domain> <email>}"
ENVF=/opt/kms-social-manager/.env
SITE=/etc/nginx/sites-available/kms-social

[[ "$DOMAIN" =~ ^[A-Za-z0-9.-]+\.[A-Za-z]{2,}$ ]] || { echo "'$DOMAIN' is not a domain name (Let's Encrypt via this script needs one)"; exit 1; }
[ -f "$ENVF" ] || { echo "Deploy the app first: deploy/deploy.sh local <branch>"; exit 1; }

# certbot from snap: the Ubuntu apt package is older and not kept current
command -v snap >/dev/null || apt-get install -y -qq snapd
snap list certbot >/dev/null 2>&1 || snap install --classic certbot
ln -sf /snap/bin/certbot /usr/local/bin/certbot

# nginx must answer for the domain so certbot can validate and edit the right server block
sed -i "s/server_name .*;/server_name $DOMAIN;/" "$SITE"
nginx -t && systemctl reload nginx

if command -v ufw >/dev/null && ufw status | grep -q "Status: active"; then ufw allow 443/tcp >/dev/null; fi

certbot --nginx -d "$DOMAIN" -m "$EMAIL" --agree-tos --no-eff-email --redirect --non-interactive

# App must know its public HTTPS address (OAuth redirects, media URLs, Secure cookie)
if grep -q '^BASE_URL=' "$ENVF"; then sed -i "s#^BASE_URL=.*#BASE_URL=https://$DOMAIN#" "$ENVF"; else echo "BASE_URL=https://$DOMAIN" >> "$ENVF"; fi
systemctl restart kms-social

echo; echo "Done: https://$DOMAIN  (certbot renews automatically; test with: sudo certbot renew --dry-run)"
echo "OAuth redirect URIs to register: https://$DOMAIN/auth/<platform>/callback"
