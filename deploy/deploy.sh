#!/usr/bin/env bash
# Usage: deploy/deploy.sh user@host [branch]
# First run: creates the kms user, installs the service. Later runs: updates code and restarts.
# Requires on the server: Node >= 20.6 (node -v), git, sudo. .env must exist at /opt/kms-social-manager/.env
set -euo pipefail
HOST="${1:?usage: deploy.sh user@host [branch]}"
BRANCH="${2:-main}"
REPO="$(git config --get remote.origin.url)"

ssh "$HOST" bash -s -- "$REPO" "$BRANCH" <<'REMOTE'
set -euo pipefail
REPO="$1"; BRANCH="$2"; DIR=/opt/kms-social-manager
node -e 'process.exit(+(process.versions.node.split(".").map(Number).reduce((a,v,i)=>a||(i==0?(v>20?-1:v<20?1:0):i==1?(v>=6?-1:1):0),0)>0))' || { echo "Node >= 20.6 required"; exit 1; }
id kms >/dev/null 2>&1 || sudo useradd --system --home "$DIR" --shell /usr/sbin/nologin kms
sudo mkdir -p "$DIR" && sudo chown -R "$USER":kms "$DIR"
if [ -d "$DIR/.git" ]; then git -C "$DIR" fetch origin "$BRANCH" && git -C "$DIR" checkout -q "$BRANCH" && git -C "$DIR" reset -q --hard "origin/$BRANCH"
else git clone -q -b "$BRANCH" "$REPO" "$DIR"; fi
[ -f "$DIR/.env" ] || { cp "$DIR/.env.example" "$DIR/.env"; echo ">> Created $DIR/.env from template. Edit it (BASE_URL, DASHBOARD_PASSWORD, API keys), then re-run."; }
sudo mkdir -p "$DIR/data" && sudo chown -R kms:kms "$DIR/data" && sudo chmod 600 "$DIR/.env" && sudo chown kms "$DIR/.env"
sudo cp "$DIR/deploy/kms-social.service" /etc/systemd/system/kms-social.service
sudo systemctl daemon-reload && sudo systemctl enable --now kms-social && sudo systemctl restart kms-social
sleep 1; systemctl is-active kms-social && curl -fsS -o /dev/null http://127.0.0.1:3000/ && echo "Deployed OK"
REMOTE
