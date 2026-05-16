// scripts/smoke.js — pre-deploy verifier.
// Usage: node --env-file=.env scripts/smoke.js
// Exits 0 if all checks pass, 1 otherwise. Prints which credential is broken.

import { Redis } from '@upstash/redis';
import Anthropic from '@anthropic-ai/sdk';

const checks = [];
const pass = (n) => checks.push({ name: n, ok: true });
const fail = (n, err) => checks.push({ name: n, ok: false, err: err?.message || String(err) });

async function checkEnvVars() {
  const required = [
    'TELEGRAM_BOT_TOKEN',
    'GOOGLE_OAUTH_CLIENT_ID',
    'GOOGLE_OAUTH_CLIENT_SECRET',
    'GOOGLE_MAPS_API_KEY',
    'ANTHROPIC_API_KEY',
    'KV_REST_API_URL',
    'KV_REST_API_TOKEN',
    'PUBLIC_BASE_URL',
  ];
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length) fail('env vars', new Error(`missing: ${missing.join(', ')}`));
  else pass('env vars');
}

async function checkUpstash() {
  try {
    const r = new Redis({ url: process.env.KV_REST_API_URL, token: process.env.KV_REST_API_TOKEN });
    const key = `smoke:${Date.now()}`;
    await r.set(key, 'ok', { ex: 60 });
    const got = await r.get(key);
    await r.del(key);
    if (got !== 'ok') throw new Error('read-back mismatch');
    pass('upstash');
  } catch (e) {
    fail('upstash', e);
  }
}

async function checkAnthropic() {
  try {
    const a = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const r = await a.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 8,
      messages: [{ role: 'user', content: 'reply with the word: ok' }],
    });
    if (!r?.content?.[0]?.text) throw new Error('no content returned');
    pass('anthropic');
  } catch (e) {
    fail('anthropic', e);
  }
}

async function checkTelegram() {
  try {
    const r = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/getMe`);
    const j = await r.json();
    if (!j.ok) throw new Error(j.description || 'getMe failed');
    pass(`telegram (bot: @${j.result.username})`);
  } catch (e) {
    fail('telegram', e);
  }
}

async function checkGoogleMaps() {
  try {
    const u = `https://maps.googleapis.com/maps/api/geocode/json?address=Singapore&key=${process.env.GOOGLE_MAPS_API_KEY}`;
    const r = await fetch(u);
    const j = await r.json();
    if (j.status !== 'OK') throw new Error(`status=${j.status} msg=${j.error_message || ''}`);
    pass('google maps (geocoding)');
  } catch (e) {
    fail('google maps', e);
  }
}

await checkEnvVars();
await Promise.all([checkUpstash(), checkAnthropic(), checkTelegram(), checkGoogleMaps()]);

let allOk = true;
for (const c of checks) {
  console.log(`${c.ok ? '✓' : '✗'} ${c.name}${c.ok ? '' : ` — ${c.err}`}`);
  if (!c.ok) allOk = false;
}
process.exit(allOk ? 0 : 1);
