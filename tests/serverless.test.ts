import { describe, it, expect } from 'vitest';
import handler from '../api/index';

function createMockReqRes(options: {
  method: string;
  url: string;
  body?: any;
  headers?: Record<string, string>;
}) {
  const req = {
    method: options.method,
    url: options.url,
    body: options.body || {},
    headers: options.headers || {}
  };

  let statusCode = 200;
  const headers: Record<string, string> = {};
  let responseData: any = null;

  const res = {
    setHeader: (name: string, value: string) => { headers[name.toLowerCase()] = value; },
    status: (code: number) => {
      statusCode = code;
      return res;
    },
    json: (data: any) => {
      responseData = data;
      return res;
    },
    end: () => res
  };

  return {
    req,
    res,
    getStatusCode: () => statusCode,
    getData: () => responseData
  };
}

describe('Vercel Serverless Backend API', () => {
  let accessToken = '';

  it('GET /actuator/health returns UP', async () => {
    const { req, res, getStatusCode, getData } = createMockReqRes({
      method: 'GET',
      url: '/actuator/health'
    });

    await handler(req, res);
    expect(getStatusCode()).toBe(200);
    expect(getData()).toEqual({ status: 'UP' });
  });

  it('POST /api/auth/login authenticates chw1 and issues JWT', async () => {
    const { req, res, getStatusCode, getData } = createMockReqRes({
      method: 'POST',
      url: '/api/auth/login',
      body: {
        staffId: 'chw1',
        password: 'Test-Password-1',
        deviceId: '00000000-0000-0000-0000-000000000001',
        deviceName: 'Vercel Test Device'
      }
    });

    await handler(req, res);
    expect(getStatusCode()).toBe(200);
    const data = getData();
    expect(data.accessToken).toBeDefined();
    expect(data.refreshToken).toBeDefined();
    expect(data.user.staffId).toBe('chw1');
    expect(data.user.role).toBe('CHW');
    accessToken = data.accessToken;
  });

  it('POST /api/sync/chunks ingests signed chunk and returns ACCEPTED', async () => {
    const event = {
      eventId: 'e-vercel-001',
      deviceId: 'dev-vercel',
      patientId: 'P-VERCEL-1',
      entityType: 'patient',
      entityId: 'P-VERCEL-1',
      op: 'create',
      hlc: '001761800000000:00001:dev-vercel',
      baseHlc: null,
      payload: JSON.stringify({ name: 'Asha Synthetic', age: 29, locality: 'Ludhiana', status: 'Stable' }),
      schemaVersion: 1,
      createdAt: new Date().toISOString()
    };

    // Calculate event hash and chunk checksum
    const crypto = await import('crypto');
    const parts = [
      event.eventId, event.deviceId, event.patientId, event.entityType,
      event.entityId, event.op, event.hlc, '', event.payload
    ];
    const eventHash = crypto.createHash('sha256').update(parts.join('|')).digest('hex');
    (event as any).hash = eventHash;

    const chunkChecksum = crypto.createHash('sha256').update(eventHash).digest('hex');

    const { req, res, getStatusCode, getData } = createMockReqRes({
      method: 'POST',
      url: '/api/sync/chunks',
      headers: { authorization: `Bearer ${accessToken}` },
      body: {
        chunkId: 'chk-vercel-1',
        deviceId: 'dev-vercel',
        sequenceNumber: 1,
        schemaVersion: 1,
        createdAt: new Date().toISOString(),
        eventIds: [event.eventId],
        events: [event],
        checksum: chunkChecksum
      }
    });

    await handler(req, res);
    expect(getStatusCode()).toBe(200);
    const data = getData();
    expect(data.acks[0].status).toBe('ACCEPTED');
  });

  it('POST /api/sync/chunks rejects corrupt checksum with HTTP 422', async () => {
    const { req, res, getStatusCode, getData } = createMockReqRes({
      method: 'POST',
      url: '/api/sync/chunks',
      headers: { authorization: `Bearer ${accessToken}` },
      body: {
        chunkId: 'chk-corrupt',
        deviceId: 'dev-vercel',
        sequenceNumber: 2,
        schemaVersion: 1,
        createdAt: new Date().toISOString(),
        eventIds: ['dummy'],
        events: [{ hash: 'fake_hash' }],
        checksum: 'corrupted_checksum'
      }
    });

    await handler(req, res);
    expect(getStatusCode()).toBe(422);
    expect(getData().error).toMatch(/checksum/i);
  });
});
