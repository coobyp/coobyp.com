// pulls public follower counts and writes stats.json. a failed source keeps its last value.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';
const get = (url, json) => fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'en-US' } })
  .then(r => { if (!r.ok) throw new Error(url + ' ' + r.status); return json ? r.json() : r.text(); });

// "54 subscribers", "1.2K subscribers", "3.4M subscribers"
function parseCount(s) {
  const m = s.replace(/,/g, '').match(/([\d.]+)\s*([KM]?)/i);
  if (!m) return NaN;
  return Math.round(parseFloat(m[1]) * ({ k: 1e3, m: 1e6 }[m[2].toLowerCase()] || 1));
}

const sources = {
  soundcloud: async () => {
    const html = await get('https://soundcloud.com/coobyp');
    return Number(html.match(/"followers_count":(\d+)/)[1]);
  },
  youtube: async () => {
    // the channel header's own count; other "subscriberCountText" entries on the page are recommended channels
    const html = await get('https://www.youtube.com/@coobyp');
    return parseCount(html.match(/"content":"([^"]*subscribers?)"/)[1]);
  },
  bluesky: async () => (await get('https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=coobyp.com', true)).followersCount,
  github: async () => (await get('https://api.github.com/users/coobyp', true)).followers,
};

const prev = existsSync('stats.json') ? JSON.parse(readFileSync('stats.json', 'utf8')).platforms || {} : {};
const manual = JSON.parse(readFileSync('manual.json', 'utf8'));
const platforms = {};

for (const [name, fn] of Object.entries(sources)) {
  try {
    const n = await fn();
    if (!Number.isFinite(n)) throw new Error('not a number');
    platforms[name] = n;
  } catch (e) {
    console.warn(name, 'failed:', e.message, '- keeping', prev[name] ?? 0);
    platforms[name] = prev[name] ?? 0;
  }
}
for (const [name, n] of Object.entries(manual)) if (!name.startsWith('_')) platforms[name] = Number(n) || 0;

const total = Object.values(platforms).reduce((a, b) => a + b, 0);
const changed = JSON.stringify(prev) !== JSON.stringify(platforms);
if (changed || !existsSync('stats.json')) {
  writeFileSync('stats.json', JSON.stringify({ total, platforms, updated: new Date().toISOString() }, null, 2) + '\n');
}
console.log(total, platforms, changed ? '(changed)' : '(unchanged)');
