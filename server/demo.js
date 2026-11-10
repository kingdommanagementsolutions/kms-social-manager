// Deterministic sample data so the dashboard is fully usable before any API keys are configured.
const hash = (s) => { let h = 2166136261; for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
function rng(seed) {
  let a = hash(seed);
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const DAY = 86_400_000;
const today = () => Math.floor(Date.now() / DAY) * DAY;

const BASE = { facebook: 8400, instagram: 12900, x: 5200, tiktok: 21500, linkedin: 3100 };
const REACH = { facebook: 0.35, instagram: 0.55, x: 0.6, tiktok: 2.2, linkedin: 0.4 };

const TEXTS = [
  'New week, new goals. What are you building this Monday? 🚀',
  'Behind the scenes with the team as we plan next quarter.',
  'Three lessons we learned from our latest client project (thread below).',
  'We just launched something we have been working on for months. Take a look!',
  'Customer spotlight: how one small team doubled their output with a simple process change.',
  'Quick tip: batch your content once a week and schedule it. Your future self says thanks.',
  'Join us this Thursday for a live Q&A. Bring your toughest questions.',
  'Grateful for everyone who showed up at this week\'s event. You made it special.',
  'Stewardship isn\'t about doing more, it\'s about doing what matters. 🙌',
  'Our free planning template is now available. Link in bio.',
  'Poll: which would help you most right now — templates, coaching, or tools?',
  'Throwback to where it all started. Look how far we\'ve come.',
];
const PEOPLE = ['Maria Lopez', 'Daniel Okafor', 'Priya Shah', 'Tom Becker', 'Grace Kim', 'Luis Ortega', 'Hannah Wright', 'Sam Patel'];
const COMMENTS = [
  'Love this! Where can I find out more?', 'Do you offer this for small teams?', 'This was so helpful, thank you!',
  'Can you share the template?', 'What time does the live Q&A start?', 'Congrats on the launch! 🎉',
  'I tried this last week and it worked great.', 'Is there a discount for nonprofits?',
];

const LABEL = { facebook: 'Facebook', instagram: 'Instagram', x: 'X', tiktok: 'TikTok', linkedin: 'LinkedIn' };
export const demoNames = (platform) => ({
  name: `KMS ${LABEL[platform]}`,
  handle: ['facebook', 'linkedin'].includes(platform) ? 'Kingdom Management Solutions' : '@kms_demo',
});

export function profile(acct) {
  const r = rng('p' + acct.id);
  return { followers: Math.round(BASE[acct.platform] * (0.9 + r() * 0.2)) };
}

export function followerSeries(acct, days) {
  const r = rng('f' + acct.id);
  const now = profile(acct).followers;
  const growth = 0.0008 + r() * 0.0025; // daily growth
  const out = [];
  for (let d = days - 1; d >= 0; d--) {
    out.push({ date: new Date(today() - d * DAY).toISOString().slice(0, 10), followers: Math.round(now / (1 + growth * d) + (r() - 0.5) * now * 0.0015) });
  }
  return out;
}

export function posts(acct, n = 36) {
  const r = rng('posts' + acct.id);
  const f = profile(acct).followers;
  const out = [];
  for (let i = 0; i < n; i++) {
    const when = today() - Math.floor(i * 2.4 * DAY) + Math.floor((9 + r() * 8) * 3600_000) - 0;
    const reach = f * REACH[acct.platform] * (0.3 + r() * 1.4) * (r() > 0.9 ? 3 : 1);
    const likes = Math.round(reach * (0.03 + r() * 0.05));
    out.push({
      id: `demo-${acct.id}-${i}`, text: TEXTS[(i + hash(acct.id)) % TEXTS.length],
      url: null, image: null, publishedAt: new Date(Math.min(when, Date.now() - 3600_000)).toISOString(),
      metrics: {
        likes, comments: Math.round(likes * (0.06 + r() * 0.1)),
        shares: acct.platform === 'instagram' ? 0 : Math.round(likes * (0.05 + r() * 0.12)),
        views: Math.round(reach),
      },
    });
  }
  return out;
}

export function comments(acct, count = 7) {
  const r = rng('c' + acct.id);
  const out = [];
  for (let i = 0; i < count; i++) {
    out.push({
      externalId: `demo-c-${acct.id}-${i}`, author: PEOPLE[Math.floor(r() * PEOPLE.length)],
      text: COMMENTS[Math.floor(r() * COMMENTS.length)],
      createdAt: new Date(Date.now() - (i * 7 + 1 + r() * 6) * 3600_000).toISOString(),
      url: null, postText: TEXTS[Math.floor(r() * TEXTS.length)],
    });
  }
  return out;
}
