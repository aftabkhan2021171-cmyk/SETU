/**
 * Central Vercel Serverless Function Handler for SETU.
 * Handles all /api/* and /actuator/* routes.
 * Fully compatible with Vercel Node runtime.
 */

import { initDatabase, getPgPool, memoryDb } from './db';
import { loginUser, refreshSession, logoutSession, verifyAccessToken, TokenPayload } from './auth';
import {
  ingestChunk,
  getChangesFeed,
  computeMerkleSummary,
  getMerkleBucketLeaves,
  fetchEventsByIds,
  getOpenConflicts,
  resolveConflict
} from './sync';

export default async function handler(req: any, res: any) {
  try {
    // CORS configuration
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization');

    if (req.method === 'OPTIONS') {
      return res.status(200).end();
    }

    try {
      await initDatabase();
    } catch (err: any) {
      console.error('Database initialization failed:', err);
      return res.status(500).json({ error: 'Database initialization failed', message: err.message });
    }

    // Determine path accurately across Vercel catch-all, rewrites, and direct calls
    let path = '';
    if (req.query && Array.isArray(req.query.path)) {
      path = '/api/' + req.query.path.join('/');
    } else if (typeof req.query?.path === 'string') {
      path = '/api/' + req.query.path;
    } else {
      const raw = req.headers?.['x-forwarded-uri'] || req.url || '';
      const pathname = raw.split('?')[0].replace(/\/+$/, '');
      path = pathname;
    }

    if (!path.startsWith('/api') && !path.startsWith('/actuator')) {
      path = `/api${path.startsWith('/') ? '' : '/'}${path}`;
    }
    path = path.replace(/\/+$/, '');

    const method = req.method ? req.method.toUpperCase() : 'GET';

    // Ensure body is parsed if delivered as raw string
    if (typeof req.body === 'string') {
      try {
        req.body = JSON.parse(req.body);
      } catch { }
    }

    // URL helper for search parameters
    const searchParams = new URLSearchParams((req.url || '').split('?')[1] || '');

    // 1. Health check
    if (path === '/actuator/health' || path === '/api/health' || path === '/api/actuator/health') {
      return res.status(200).json({ status: 'UP' });
    }

    // 2. Authentication endpoints
    if (path === '/api/auth/login' && method === 'POST') {
      const { staffId, password, deviceId, deviceName } = req.body || {};
      if (!staffId || !password || !deviceId) {
        return res.status(400).json({ error: 'Missing required credentials' });
      }
      try {
        const data = await loginUser(staffId, password, deviceId, deviceName || 'Web Device');
        return res.status(200).json(data);
      } catch (err: any) {
        const status = err.message.includes('revoked') ? 403 : 401;
        return res.status(status).json({ error: err.message });
      }
    }

    if (path === '/api/auth/refresh' && method === 'POST') {
      const { refreshToken } = req.body || {};
      if (!refreshToken) return res.status(400).json({ error: 'Missing refreshToken' });
      try {
        const data = await refreshSession(refreshToken);
        return res.status(200).json(data);
      } catch (err: any) {
        return res.status(403).json({ error: err.message });
      }
    }

    if (path === '/api/auth/logout' && method === 'POST') {
      const { refreshToken } = req.body || {};
      await logoutSession(refreshToken);
      return res.status(204).end();
    }

    // Authenticate all remaining protected routes
    const authHeader = req.headers?.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    const user: TokenPayload | null = token ? verifyAccessToken(token) : null;

    if (!user) {
      return res.status(401).json({ error: 'Unauthorized. Valid Bearer token required.' });
    }

    // 3. Sync Chunks Ingestion
    if (path === '/api/sync/chunks' && method === 'POST') {
      try {
        const result = await ingestChunk(req.body, user);
        return res.status(200).json(result);
      } catch (err: any) {
        return res.status(err.status || 500).json({ error: err.message });
      }
    }

    // 4. Sync Changes Feed
    if (path === '/api/sync/changes' && method === 'GET') {
      const since = parseInt(req.query?.since || searchParams.get('since') || '0', 10);
      const limit = Math.min(parseInt(req.query?.limit || searchParams.get('limit') || '50', 10), 100);
      const deviceId = req.query?.deviceId || searchParams.get('deviceId') || '';
      try {
        const result = await getChangesFeed(since, limit, deviceId, user);
        return res.status(200).json(result);
      } catch (err: any) {
        return res.status(500).json({ error: err.message });
      }
    }

    // 5. Merkle Tree Summary
    if (path === '/api/sync/merkle' && method === 'GET') {
      try {
        const summary = await computeMerkleSummary(user);
        return res.status(200).json(summary);
      } catch (err: any) {
        return res.status(500).json({ error: err.message });
      }
    }

    // 6. Merkle Bucket Leaves
    if (path.startsWith('/api/sync/merkle/buckets/') && method === 'GET') {
      const prefix = path.replace('/api/sync/merkle/buckets/', '');
      try {
        const leaves = await getMerkleBucketLeaves(prefix, user);
        return res.status(200).json(leaves);
      } catch (err: any) {
        return res.status(500).json({ error: err.message });
      }
    }

    // 7. Fetch Missing Events by IDs
    if (path === '/api/sync/events/fetch' && method === 'POST') {
      const { eventIds } = req.body || {};
      if (!Array.isArray(eventIds)) return res.status(400).json({ error: 'eventIds must be an array' });
      try {
        const events = await fetchEventsByIds(eventIds, user);
        return res.status(200).json(events);
      } catch (err: any) {
        return res.status(500).json({ error: err.message });
      }
    }

    // 8. Conflicts List
    if (path === '/api/conflicts' && method === 'GET') {
      try {
        const conflicts = await getOpenConflicts(user);
        return res.status(200).json(conflicts);
      } catch (err: any) {
        return res.status(500).json({ error: err.message });
      }
    }

    // 9. Conflict Resolution
    const resolveMatch = path.match(/^\/api\/conflicts\/([^/]+)\/resolve$/);
    if (resolveMatch && method === 'POST') {
      const conflictId = resolveMatch[1];
      if (user.role !== 'DOCTOR' && user.role !== 'ADMIN') {
        return res.status(403).json({ error: 'Only clinicians can resolve conflicts' });
      }
      try {
        await resolveConflict(conflictId, req.body, user);
        return res.status(200).json({ status: 'RESOLVED', id: conflictId });
      } catch (err: any) {
        return res.status(500).json({ error: err.message });
      }
    }

    // 10. Patients List
    if (path === '/api/patients' && method === 'GET') {
      const pg = getPgPool();
      let rows: any[] = [];
      if (pg) {
        const res = await pg.query('SELECT * FROM patients WHERE ($1 IN (\'ADMIN\',\'DOCTOR\') OR district = $2) AND archived = FALSE', [user.role, user.district]);
        rows = res.rows;
      } else {
        rows = Array.from(memoryDb.patients.values()).filter(p => {
          if (p.archived) return false;
          if (user.role !== 'ADMIN' && user.role !== 'DOCTOR' && p.district !== user.district) return false;
          return true;
        });
      }
      return res.status(200).json(rows);
    }

    return res.status(404).json({ error: 'Endpoint not found', path });
  } catch (fatalErr: any) {
    console.error('Fatal unhandled error in API handler:', fatalErr);
    if (!res.headersSent) {
      return res.status(500).json({
        error: 'Internal Server Error',
        message: fatalErr.message || String(fatalErr)
      });
    }
  }
}
