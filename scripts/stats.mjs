// pulls public follower counts and writes stats.json. a failed source keeps its last value.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';
const get = (url, json) => fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'en-US' } })
  .then(r => { if (!r.ok) throw new Error(url.split('?')[0] + ' ' + r.status); return json ? r.json() : r.text(); });

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

// official apis, only when their secrets exist. x bills per call (~$0.01), so it runs once a day.
const { IG_TOKEN, X_BEARER } = process.env;
const DAY = 864e5;
const prevFile = existsSync('stats.json') ? JSON.parse(readFileSync('stats.json', 'utf8')) : {};
const checked = { ...(prevFile.checked || {}) };
if (IG_TOKEN) {
  sources.instagram = async () => {
    // long-lived tokens die after 60 days; refresh weekly and hand the new one to the workflow to save
    if (!checked.ig_refresh || Date.now() - Date.parse(checked.ig_refresh) > 7 * DAY) {
      const r = await get('https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=' + IG_TOKEN, true);
      if (r.access_token && process.env.IG_TOKEN_OUT) writeFileSync(process.env.IG_TOKEN_OUT, r.access_token);
      checked.ig_refresh = new Date().toISOString();
    }
    return (await get('https://graph.instagram.com/me?fields=followers_count&access_token=' + IG_TOKEN, true)).followers_count;
  };
}
if (X_BEARER && (!checked.x || Date.now() - Date.parse(checked.x) > 20 * 36e5)) {
  sources.x = async () => {
    const r = await fetch('https://api.x.com/2/users/by/username/coobyp?user.fields=public_metrics', { headers: { Authorization: 'Bearer ' + X_BEARER } });
    if (!r.ok) throw new Error('x ' + r.status);
    checked.x = new Date().toISOString();
    return (await r.json()).data.public_metrics.followers_count;
  };
}

const prev = prevFile.platforms || {};
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
// manual numbers cover platforms with no api secret. an api-managed platform skipped this run (x between daily checks) keeps its last value.
const apiManaged = { instagram: !!IG_TOKEN, x: !!X_BEARER };
for (const [name, n] of Object.entries(manual)) {
  if (name.startsWith('_') || name in platforms) continue;
  platforms[name] = apiManaged[name] && name in prev ? prev[name] : Number(n) || 0;
}

const total = Object.values(platforms).reduce((a, b) => a + b, 0);
const changed = JSON.stringify(prev) !== JSON.stringify(platforms) || JSON.stringify(prevFile.checked || {}) !== JSON.stringify(checked);
if (changed || !existsSync('stats.json')) {
  writeFileSync('stats.json', JSON.stringify({ total, platforms, checked, updated: new Date().toISOString() }, null, 2) + '\n');
}
console.log(total, platforms, changed ? '(changed)' : '(unchanged)');
