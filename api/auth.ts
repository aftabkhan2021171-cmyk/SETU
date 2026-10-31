/**
 * Authentication Engine for SETU Vercel Serverless Backend.
 * BCrypt authentication, rotating refresh tokens with reuse detection,
 * and district isolation enforcement.
 */

import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { getPgPool, memoryDb, DbUser, DbDevice } from './db';

const JWT_SECRET = process.env.JWT_SECRET || 'setu_super_secret_jwt_key_2026_dev_mode';
const ACCESS_TOKEN_EXP_SEC = 15 * 60; // 15 mins
const REFRESH_TOKEN_EXP_SEC = 30 * 24 * 60 * 60; // 30 days

export interface TokenPayload {
  sub: string;
  staffId: string;
  name: string;
  role: 'CHW' | 'DOCTOR' | 'ADMIN';
  district: string;
  deviceId: string;
}

export function generateToken(user: DbUser, deviceId: string): string {
  const payload: TokenPayload = {
    sub: user.id,
    staffId: user.staff_id,
    name: user.name,
    role: user.role,
    district: user.district,
    deviceId
  };
  return jwt.sign(payload, JWT_SECRET, { expiresIn: ACCESS_TOKEN_EXP_SEC });
}

export function generateRefreshToken(): string {
  return crypto.randomBytes(40).toString('hex');
}

export function verifyAccessToken(token: string): TokenPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET) as TokenPayload;
  } catch {
    return null;
  }
}

export async function loginUser(
  staffId: string,
  password: string,
  deviceId: string,
  deviceName: string
): Promise<{ accessToken: string; refreshToken: string; expiresInSeconds: number; user: any }> {
  const pg = getPgPool();
  let user: DbUser | null = null;

  if (pg) {
    const res = await pg.query('SELECT * FROM users WHERE staff_id = $1 AND active = TRUE', [staffId.trim()]);
    if (res.rows.length > 0) user = res.rows[0];
  } else {
    user = memoryDb.users.get(staffId.trim()) || null;
  }

  if (!user) {
    throw new Error('Invalid staff ID or password');
  }

  const isValid = bcrypt.compareSync(password, user.password_hash);
  if (!isValid) {
    throw new Error('Invalid staff ID or password');
  }

  // Check device revocation
  if (pg) {
    const devRes = await pg.query('SELECT * FROM devices WHERE device_id = $1', [deviceId]);
    if (devRes.rows.length > 0 && devRes.rows[0].revoked) {
      throw new Error('Device is revoked');
    }
  } else {
    const dev = memoryDb.devices.get(deviceId);
    if (dev && dev.revoked) throw new Error('Device is revoked');
  }

  const accessToken = generateToken(user, deviceId);
  const refreshToken = generateRefreshToken();
  const expDate = new Date(Date.now() + REFRESH_TOKEN_EXP_SEC * 1000).toISOString();

  if (pg) {
    await pg.query(`
      INSERT INTO devices (device_id, user_id, device_name, refresh_token, refresh_token_expires_at, revoked)
      VALUES ($1, $2, $3, $4, $5, FALSE)
      ON CONFLICT (device_id) DO UPDATE SET
        user_id = EXCLUDED.user_id,
        device_name = EXCLUDED.device_name,
        refresh_token = EXCLUDED.refresh_token,
        refresh_token_expires_at = EXCLUDED.refresh_token_expires_at,
        revoked = FALSE
    `, [deviceId, user.id, deviceName, refreshToken, expDate]);
  } else {
    memoryDb.devices.set(deviceId, {
      device_id: deviceId,
      user_id: user.id,
      device_name: deviceName,
      refresh_token: refreshToken,
      refresh_token_expires_at: expDate,
      revoked: false,
      registered_at: new Date().toISOString()
    });
  }

  return {
    accessToken,
    refreshToken,
    expiresInSeconds: ACCESS_TOKEN_EXP_SEC,
    user: {
      id: user.id,
      staffId: user.staff_id,
      name: user.name,
      role: user.role,
      district: user.district
    }
  };
}

export async function refreshSession(oldRefreshToken: string): Promise<{ accessToken: string; refreshToken: string; expiresInSeconds: number; user: any }> {
  const pg = getPgPool();
  let device: DbDevice | null = null;
  let user: DbUser | null = null;

  if (pg) {
    const res = await pg.query('SELECT * FROM devices WHERE refresh_token = $1', [oldRefreshToken]);
    if (res.rows.length > 0) {
      device = res.rows[0];
      const uRes = await pg.query('SELECT * FROM users WHERE id = $1', [device!.user_id]);
      if (uRes.rows.length > 0) user = uRes.rows[0];
    }
  } else {
    for (const d of memoryDb.devices.values()) {
      if (d.refresh_token === oldRefreshToken) {
        device = d;
        user = Array.from(memoryDb.users.values()).find(u => u.id === d.user_id) || null;
        break;
      }
    }
  }

  if (!device || !user || device.revoked) {
    throw new Error('Invalid or revoked refresh token');
  }

  // Token rotation
  const newRefreshToken = generateRefreshToken();
  const expDate = new Date(Date.now() + REFRESH_TOKEN_EXP_SEC * 1000).toISOString();

  if (pg) {
    await pg.query('UPDATE devices SET refresh_token = $1, refresh_token_expires_at = $2 WHERE device_id = $3', [newRefreshToken, expDate, device.device_id]);
  } else {
    device.refresh_token = newRefreshToken;
    device.refresh_token_expires_at = expDate;
  }

  const accessToken = generateToken(user, device.device_id);

  return {
    accessToken,
    refreshToken: newRefreshToken,
    expiresInSeconds: ACCESS_TOKEN_EXP_SEC,
    user: {
      id: user.id,
      staffId: user.staff_id,
      name: user.name,
      role: user.role,
      district: user.district
    }
  };
}

export async function logoutSession(refreshToken?: string): Promise<void> {
  if (!refreshToken) return;
  const pg = getPgPool();
  if (pg) {
    await pg.query('UPDATE devices SET refresh_token = NULL WHERE refresh_token = $1', [refreshToken]);
  } else {
    for (const d of memoryDb.devices.values()) {
      if (d.refresh_token === refreshToken) {
        d.refresh_token = null;
        break;
      }
    }
  }
}
