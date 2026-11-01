/**
 * Windows & Serverless Migration Script for Task 1.7.
 * Backfills existing PostgreSQL rows to AES-256-GCM encryption when SETU_DATA_KEY is configured.
 * 
 * Usage on Windows PowerShell:
 *   $env:SETU_DATA_KEY = "v1:your-64-character-hex-encryption-key"
 *   $env:DATABASE_URL = "postgres://..."
 *   node scripts/server_encrypt_backfill.js
 */

const { Pool } = require('pg');
const crypto = require('crypto');

function getKey() {
  const envKey = process.env.SETU_DATA_KEY;
  if (!envKey) {
    console.error('ERROR: SETU_DATA_KEY environment variable is not set.');
    process.exit(1);
  }
  let keyId = 'v1';
  let rawHex = envKey.trim();
  if (rawHex.includes(':')) {
    const parts = rawHex.split(':');
    keyId = parts[0];
    rawHex = parts[1];
  }
  const keyBuffer = rawHex.length === 64
    ? Buffer.from(rawHex, 'hex')
    : crypto.createHash('sha256').update(rawHex).digest();
  return { keyId, keyBuffer };
}

function encrypt(plaintext, keyConfig) {
  if (!plaintext || plaintext.startsWith('enc:')) return plaintext;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', keyConfig.keyBuffer, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `enc:${keyConfig.keyId}:${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

async function run() {
  const keyConfig = getKey();
  const connStr = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!connStr) {
    console.log('No DATABASE_URL configured. In-memory / dev mode active; no remote database to migrate.');
    return;
  }

  const pool = new Pool({
    connectionString: connStr,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined
  });

  console.log(`Starting PostgreSQL AES-256-GCM migration using keyId: ${keyConfig.keyId}...`);

  // Migrate patients
  const patientsRes = await pool.query("SELECT id, name FROM setu_patients WHERE name NOT LIKE 'enc:%'");
  console.log(`Found ${patientsRes.rows.length} unencrypted patient records.`);
  for (const row of patientsRes.rows) {
    const encName = encrypt(row.name, keyConfig);
    await pool.query('UPDATE setu_patients SET name = $1 WHERE id = $2', [encName, row.id]);
  }

  // Migrate events
  const eventsRes = await pool.query("SELECT event_id, payload FROM setu_events WHERE payload NOT LIKE 'enc:%'");
  console.log(`Found ${eventsRes.rows.length} unencrypted event payloads.`);
  for (const row of eventsRes.rows) {
    const encPayload = encrypt(row.payload, keyConfig);
    await pool.query('UPDATE setu_events SET payload = $1 WHERE event_id = $2', [encPayload, row.event_id]);
  }

  console.log('Migration completed successfully.');
  await pool.end();
}

run().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
