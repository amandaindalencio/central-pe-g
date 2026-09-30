// Small internal "documents" store: one JSON blob per key.
//
// Uses the Redis database connected to this Vercel project (Storage →
// Redis) via the standard REDIS_URL connection string. Falls back to a
// local JSON file under .data/ so `next dev` works before a database is
// provisioned — that fallback is NOT durable in production (serverless
// filesystem), only for local development.

const fs = require('fs');
const path = require('path');
const { createClient } = require('redis');

const LOCAL_DIR = path.join(process.cwd(), '.data');

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

// Reused across invocations on a warm serverless instance — node-redis
// clients are meant to be long-lived, not created per request.
let clientPromise = null;
function getClient() {
  if (!process.env.REDIS_URL) return null;
  if (!clientPromise) {
    const client = createClient({ url: process.env.REDIS_URL });
    client.on('error', (err) => console.error('Redis client error', err));
    clientPromise = client.connect().then(() => client);
  }
  return clientPromise;
}

async function getDoc(key) {
  const client = await getClient();
  if (client) {
    const raw = await client.get(key);
    return raw ? JSON.parse(raw) : null;
  }
  return localGet(key);
}

async function setDoc(key, value) {
  const client = await getClient();
  if (client) {
    await client.set(key, JSON.stringify(value));
    return;
  }
  localSet(key, value);
}

module.exports = { getDoc, setDoc };
