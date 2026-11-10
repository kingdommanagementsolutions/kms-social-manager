#!/usr/bin/env bash
# Removes KMS Social Manager from this server: the systemd service, the nginx site and /opt/kms-social-manager
# (including its database, uploads and encryption key). Leaves Node, nginx, git and certbot installed.
# Usage: sudo deploy/uninstall.sh [-y]      (back up /opt/kms-social-manager/data first if you want to keep it)
set -euo pipefail
[ "$(id -u)" -eq 0 ] || { echo "Run with sudo"; exit 1; }
DIR=/opt/kms-social-manager
echo "This will permanently delete:"
echo "  - systemd service kms-social"
echo "  - nginx site /etc/nginx/sites-{available,enabled}/kms-social"
echo "  - $DIR (code, .env, data/kms.db, uploads, data/.secret)"
echo "  - system user 'kms'"
if [ "${1:-}" != "-y" ]; then read -r -p "Type 'remove' to continue: " a; [ "$a" = remove ] || { echo "Aborted."; exit 1; }; fi

systemctl disable --now kms-social 2>/dev/null || true
rm -f /etc/systemd/system/kms-social.service && systemctl daemon-reload
rm -f /etc/nginx/sites-enabled/kms-social /etc/nginx/sites-available/kms-social
if command -v nginx >/dev/null; then nginx -t && systemctl reload nginx || echo "nginx config needs attention"; fi
rm -rf "$DIR"
id kms >/dev/null 2>&1 && userdel kms || true
echo "Removed. (If you ran enable-https.sh, also: sudo certbot delete --cert-name <your.domain>)"
