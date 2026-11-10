# KMS Social Manager

A self-hosted social media command center for Kingdom Management Solutions, in the spirit of Meta Business Suite but across **Facebook Pages, Instagram, X, TikTok and LinkedIn**. Zero runtime dependencies: Node 22.13+ (uses the built-in SQLite) and a browser.

## Features

| | |
|---|---|
| **Dashboard** | Followers, engagement, posts, queue, latest comments, top posts across all accounts |
| **Create post** | One composer for many accounts, per-platform character limits, media upload/URL, live preview |
| **Calendar** | Month view of scheduled and published posts; click a day to schedule |
| **Posts** | Queue/history with retry for failures, plus what is live on each platform with its metrics |
| **Inbox** | Unified comments with read/unread and replies sent back through each platform's API |
| **Analytics** | 7/30/90-day engagement and follower trends, per-account table, platform comparison, top posts |
| **Accounts** | OAuth connect/disconnect per platform, with setup help for anything not yet configured |

A built-in scheduler publishes due posts every 20 seconds. Tokens are encrypted at rest (AES-256-GCM, key in `data/.secret` or `APP_SECRET`; data lives in `data/kms.db`) and refreshed automatically (X, TikTok).

## Run it

```bash
cp .env.example .env     # optional: add API credentials and a password
npm start                # http://localhost:3000
```

With no credentials configured you can still click **Add demo account** on the Accounts page to explore everything with sample data. Demo accounts are clearly labelled and never call any external API.

```bash
npm test                 # unit tests (node:test)
```

## Connecting real accounts

For each platform, create a developer app, register the redirect URI `BASE_URL/auth/<platform>/callback` (shown on the Accounts page), paste its credentials into that platform's **API credentials** panel on the Accounts page, and click **Connect**. Credentials are stored encrypted in SQLite and are never sent back to the browser. (Credentials in `.env` still work and are imported into the database on first start.)

| Platform | Credentials | Capabilities | Caveats |
|---|---|---|---|
| Facebook Pages | `META_APP_ID`, `META_APP_SECRET` | publish, post stats, comments + replies, followers | Meta app review is needed for Pages permissions beyond your own admin/tester accounts |
| Instagram | same Meta app | publish (image/Reels), post stats, comments + replies, followers | Business/Creator account linked to a Page; media must be a public URL |
| X | `X_CLIENT_ID`, `X_CLIENT_SECRET` | publish text, timeline stats, mentions + replies | Reading data needs a paid API tier; media upload not implemented |
| TikTok | `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET` | publish video (pull from URL), video stats, followers | Unaudited apps can only post privately (`TIKTOK_PRIVACY=SELF_ONLY`); no comments API |
| LinkedIn | `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET` | publish text to member profile | Reading posts/analytics is restricted to LinkedIn partners |

Platform APIs change often; each integration is one small file in `server/providers/` exposing `connect`, `publish`, `fetchPosts`, `fetchProfile`, `fetchComments`, `reply` (and `refresh`). Adding a platform means adding a file and registering it in `server/providers/index.js`. Capability flags in each file's `meta.features` drive what the UI offers. The integrations were written against the public API docs but **have not been run against live accounts**, so expect to adjust scopes/fields during your first real connection.

## Dashboard password

`npm run set-password` prompts once (typing is hidden) and stores only a salted scrypt hash in the database, so no plain-text password lives in `.env` or your shell history. It takes effect immediately and signs out existing sessions. There is no email reset: to change or recover the password, run the command again on the machine hosting the app (`npm run set-password -- --clear` removes it). `DASHBOARD_PASSWORD` in `.env` still works as a fallback.

## Going beyond localhost

- Set `BASE_URL` to your public HTTPS address (OAuth redirects and uploaded media URLs depend on it; Instagram and TikTok fetch media from it).
- Run `npm run set-password` (or set `DASHBOARD_PASSWORD`). Without a password, anyone who can reach the server can post to your accounts.
- Keep `data/` (SQLite database, uploads, encryption key) and back up `kms.db` and `.secret` together: the database is unreadable without the key. Keep `data/` on persistent storage and out of git. Set `APP_SECRET` if you want to manage the encryption key yourself.
- The scheduler runs inside the server process, so keep it running (systemd, Docker, a PaaS) for scheduled posts to go out.

## Layout

```
server/            http server, routes, OAuth, scheduler, encrypted JSON store
server/providers/  one file per platform
server/demo.js     deterministic sample data
public/            single-page UI (vanilla JS modules, inline-SVG charts)
tests/             node:test suite
```

## Deploying to a VPS (systemd, no Docker)

1. On the server (Ubuntu 24.04): `sudo deploy/setup-ubuntu.sh` installs Node 22, git and nginx, and configures nginx to proxy port 80 to the app. No domain needed: browse to `http://<server-ip>/kms-social-dashboard/`.
2. `deploy/deploy.sh local <branch>` on the server itself, or `deploy/deploy.sh user@your-server <branch>` from another machine (clones to `/opt/kms-social-manager`, installs the `kms-social` systemd service, restarts it).
3. The first run creates `/opt/kms-social-manager/.env` from the template. Edit it (`BASE_URL=http://<server-ip>/kms-social-dashboard`, `DASHBOARD_PASSWORD`, API keys), then run the script again.
4. Logs: `journalctl -u kms-social -f`. Back up `/opt/kms-social-manager/data`.

**IP-only caveats.** Without a domain there is no trusted HTTPS certificate, so traffic (including the dashboard password) is unencrypted, and most platforms won't work against it: Meta, TikTok, X and LinkedIn require HTTPS redirect URIs, and Instagram/TikTok fetch uploaded media over a valid HTTPS URL. Demo mode and the UI work fine. For real connections, point a domain at the server and run `sudo deploy/enable-https.sh your.domain you@example.com`, which gets a Let's Encrypt certificate via certbot, redirects HTTP to HTTPS and updates `BASE_URL` (keeping the `/kms-social-dashboard` path). Until then, restrict access with a firewall or a VPN.
