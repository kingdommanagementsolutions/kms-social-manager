import path from 'node:path';
import { fileURLToPath } from 'node:url';

try { process.loadEnvFile(); } catch { /* no .env file: fine */ }

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const PORT = Number(process.env.PORT) || 3000;
// Bind to loopback by default; nginx is the public entry point. Set HOST=0.0.0.0 to expose directly.
export const HOST = process.env.HOST || '127.0.0.1';
export const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
export const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
export const PUBLIC_DIR = path.join(ROOT, 'public');
export const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
export const PASSWORD = process.env.DASHBOARD_PASSWORD || '';
// URL path the app is mounted under (nginx strips it), e.g. /kms-social-dashboard. Empty when served from the root.
export const BASE_PATH = new URL(BASE_URL).pathname.replace(/\/$/, '');
