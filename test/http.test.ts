import { describe, expect, test } from 'bun:test';
import { buildApp } from '../src/app';
import { buildServices } from '../src/services';
import { StonkFunClient } from '../src/stonkfun/client';
import { SqliteLedger } from '../src/ledger/store';
import { MINTS } from '../src/config';

const pairs = [
  { mint: MINTS.ANSEM, symbol: 'ANSEM', name: 'The Black Bull', decimals: 6, category: 'custom', categoryLabel: 'Custom', tokenProgram: 'T22', launchable: true, symbolAmbiguous: true, launchLabReady: true },
  { mint: 'Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh', symbol: 'NVDAX', name: 'NVIDIA', decimals: 8, category: 'xstock', categoryLabel: 'xStock', tokenProgram: 'T22', launchable: true, symbolAmbiguous: false, launchLabReady: true },
  { mint: 'So11111111111111111111111111111111111111112', symbol: 'SOL', name: 'Solana', decimals: 9, category: 'solana', categoryLabel: 'Solana', tokenProgram: 'Tok', launchable: true, symbolAmbiguous: false, launchLabReady: true },
];
const fetchImpl = (async () => new Response(JSON.stringify({ data: { pairs } }), { status: 200, headers: { 'Content-Type': 'application/json' } })) as unknown as typeof fetch;

async function app() {
  const svc = buildServices({ stonkfun: new StonkFunClient({ fetchImpl, baseUrl: 'https://fake/api/public/v1' }), ledger: new SqliteLedger(':memory:'), treasury: null });
  return { app: await buildApp(svc), svc };
}

describe('HTTP surface (payments disabled)', () => {
  test('GET / lists routes and pinned mints', async () => {
    const { app: a } = await app();
    const res = await a.request('/');
    const body = (await res.json()) as any;
    expect(res.status).toBe(200);
    expect(body.pinned.ANSEM).toBe(MINTS.ANSEM);
    expect(body.routing_rule).toMatch(/pump\.fun/);
  });

  test('GET /v1/pairs excludes SOL and includes pinned ANSEM', async () => {
    const { app: a } = await app();
    const res = await a.request('/v1/pairs');
    const body = (await res.json()) as any;
    expect(res.status).toBe(200);
    const symbols = body.data.pairs.map((p: any) => p.symbol);
    expect(symbols).toContain('ANSEM');
    expect(symbols).toContain('NVDAX');
    expect(symbols).not.toContain('SOL');
    expect(body.data.pairs[0].pinned).toBe('ANSEM');
  });

  test('POST /v1/launch/self validates the body', async () => {
    const { app: a } = await app();
    const res = await a.request('/v1/launch/self', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'x' }) });
    expect(res.status).toBe(400);
    const body = (await res.json()) as any;
    expect(body.error.code).toBe('invalid_request');
  });

  test('POST /v1/launch/managed without treasury is 503', async () => {
    const { app: a } = await app();
    const res = await a.request('/v1/launch/managed', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentWallet: 'vines1vzrYbzLMRdu58ou5XTby4qAqVRLmqo36NKPTg', quoteMint: MINTS.ANSEM, name: 'Bull Dividend', symbol: 'BULLDIV', logo: 'data:image/png;base64,iVBORw0KGgo=', mode: 'reward', idempotencyKey: 'http-managed-1' }),
    });
    expect(res.status).toBe(503);
    expect(((await res.json()) as any).error.code).toBe('managed_unavailable');
  });

  test('holder route is off until the entry token exists', async () => {
    const { app: a } = await app();
    const res = await a.request('/v1/launch/self/holder', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    expect(res.status).toBe(503);
  });

  test('MCP tools/list and stonkflow_pairs', async () => {
    const { app: a } = await app();
    const list = await a.request('/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) });
    const listBody = (await list.json()) as any;
    expect(listBody.result.tools.map((t: any) => t.name)).toContain('stonkflow_launch');
    const call = await a.request('/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'stonkflow_pairs', arguments: {} } }) });
    const callBody = (await call.json()) as any;
    expect(callBody.result.isError).toBeUndefined();
    expect(callBody.result.content[0].text).toContain(MINTS.ANSEM);
  });

  test('ledger page renders', async () => {
    const { app: a } = await app();
    const res = await a.request('/ledger');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('StonkFlow ledger');
  });
});
