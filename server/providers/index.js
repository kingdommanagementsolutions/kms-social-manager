import * as facebook from './facebook.js';
import * as instagram from './instagram.js';
import * as x from './x.js';
import * as tiktok from './tiktok.js';
import * as linkedin from './linkedin.js';

export const providers = { facebook, instagram, x, tiktok, linkedin };
export const publicMeta = () => Object.values(providers).map((p) => ({ ...p.meta, configured: p.configured() }));
