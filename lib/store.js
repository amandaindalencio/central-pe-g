// Small internal "documents" store: one JSON blob per key.
//
// Uses Upstash Redis (via Vercel's Redis/Upstash integration — Vercel KV was
// deprecated in favor of this) when the project has a store linked: the
// integration sets KV_REST_API_URL/KV_REST_API_TOKEN (or, on a standalone
// Upstash account, UPSTASH_REDIS_REST_URL/UPSTASH_REDIS_REST_TOKEN) env vars
// automatically. Falls back to a local JSON file under .data/ so `next dev`
// works before a store is provisioned — that fallback is NOT durable in
// production (serverless filesystem), only for local development.

const fs = require('fs');
const path = require('path');

const LOCAL_DIR = path.join(process.cwd(), '.data');

function redisConfig() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? { url, token } : null;
}

function localFile(key) {
  return path.join(LOCAL_DIR, key.replace(/[^a-zA-Z0-9_-]/g, '_') + '.json');
}
function localGet(key) {
  const file = localFile(key);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf-8'));
}
function localSet(key, value) {
  if (!fs.existsSync(LOCAL_DIR)) fs.mkdirSync(LOCAL_DIR, { recursive: true });
  fs.writeFileSync(localFile(key), JSON.stringify(value));
}

async function getDoc(key) {
  const cfg = redisConfig();
  if (cfg) {
    const { Redis } = require('@upstash/redis');
    const redis = new Redis(cfg);
    return (await redis.get(key)) || null;
  }
  return localGet(key);
}

async function setDoc(key, value) {
  const cfg = redisConfig();
  if (cfg) {
    const { Redis } = require('@upstash/redis');
    const redis = new Redis(cfg);
    await redis.set(key, value);
    return;
  }
  localSet(key, value);
}

module.exports = { getDoc, setDoc };
