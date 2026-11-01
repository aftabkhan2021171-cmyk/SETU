/**
 * Server-Side AES-256-GCM Column Encryption for PostgreSQL / Serverless.
 * Task 1.7: When SETU_DATA_KEY is configured, encrypts sensitive columns
 * (patient names, event payloads) before database writes, and decrypts on reads.
 * If unset, runs exactly as today (backwards-compatible zero-config mode).
 */

import crypto from 'crypto';

interface ServerKeyConfig {
  keyId: string;
  keyBuffer: Buffer;
}

let cachedKeyConfig: ServerKeyConfig | null = null;
let lastEnvKey: string | undefined = undefined;

function getServerKey(): ServerKeyConfig | null {
  const envKey = process.env.SETU_DATA_KEY;
  if (!envKey) return null;

  if (cachedKeyConfig && lastEnvKey === envKey) {
    return cachedKeyConfig;
  }

  let keyId = 'v1';
  let rawHex = envKey.trim();

  if (rawHex.includes(':')) {
    const parts = rawHex.split(':');
    keyId = parts[0];
    rawHex = parts[1];
  }

  if (rawHex.length !== 64) {
    // If not a 64-hex string, derive 32 bytes via SHA-256
    const hash = crypto.createHash('sha256').update(rawHex).digest();
    cachedKeyConfig = { keyId, keyBuffer: hash };
  } else {
    cachedKeyConfig = { keyId, keyBuffer: Buffer.from(rawHex, 'hex') };
  }

  lastEnvKey = envKey;
  return cachedKeyConfig;
}

export function isServerEncryptionEnabled(): boolean {
  return getServerKey() !== null;
}

/**
 * Encrypts a plaintext string using AES-256-GCM.
 * Output format: enc:<keyId>:<ivHex>:<tagHex>:<cipherHex>
 */
export function encryptServerField(plaintext: string): string {
  const keyConfig = getServerKey();
  if (!keyConfig) return plaintext; // Pass-through if unset

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', keyConfig.keyBuffer, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return `enc:${keyConfig.keyId}:${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

/**
 * Decrypts a server field. If not encrypted with enc: prefix, returns text as-is.
 */
export function decryptServerField(value: string | null | undefined): string {
  if (!value) return '';
  if (!value.startsWith('enc:')) return value; // Plaintext legacy row

  const keyConfig = getServerKey();
  if (!keyConfig) return value;

  try {
    const parts = value.split(':');
    if (parts.length < 5) return value;

    const [_, keyId, ivHex, tagHex, cipherHex] = parts;
    const iv = Buffer.from(ivHex, 'hex');
    const tag = Buffer.from(tagHex, 'hex');
    const ciphertext = Buffer.from(cipherHex, 'hex');

    const decipher = crypto.createDecipheriv('aes-256-gcm', keyConfig.keyBuffer, iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

    return decrypted.toString('utf8');
  } catch (err) {
    console.error('Server decryption failed:', err);
    return value; // Fallback to raw value on decryption error
  }
}

export { default } from './index';
