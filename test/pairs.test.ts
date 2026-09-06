import { describe, expect, test } from 'bun:test';
import { toPairRow, resolveQuote, PairError } from '../src/core/pairs';
import { StonkFunClient } from '../src/stonkfun/client';
import { MINTS } from '../src/config';
import type { StonkPair } from '../src/stonkfun/types';

const pair = (over: Partial<StonkPair>): StonkPair => ({
  mint: 'Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh',
  symbol: 'NVDAX',
  name: 'NVIDIA',
  decimals: 8,
  category: 'xstock',
  categoryLabel: 'xStock',
  tokenProgram: 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
  launchable: true,
  symbolAmbiguous: false,
  launchLabReady: true,
  ...over,
});

const FIXTURE: StonkPair[] = [
  pair({}),
  pair({ mint: MINTS.ANSEM, symbol: 'ANSEM', name: 'The Black Bull', decimals: 6, category: 'custom', categoryLabel: 'Custom', symbolAmbiguous: true }),
  pair({ mint: '4BGQv1YJSDas6NjAkQoLGCFyZBBDtUb9Xg2V8c1Hpump', symbol: 'ANSEM', name: 'The Black Bull', decimals: 6, category: 'custom', categoryLabel: 'Custom', symbolAmbiguous: true }),
  pair({ mint: 'So11111111111111111111111111111111111111112', symbol: 'SOL', name: 'Solana', decimals: 9, category: 'solana', categoryLabel: 'Solana' }),
  pair({ mint: 'MUxEsUKSMAxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', symbol: 'MU', name: 'Micron', decimals: 6, category: 'backpack', categoryLabel: 'Backpack' }),
  pair({ mint: 'Xs8S1uUs1zxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', symbol: 'QQQX', name: 'QQQ', category: 'xstock', launchLabReady: false }),
];

function fakeClient(pairs: StonkPair[]) {
  const fetchImpl = (async () => new Response(JSON.stringify({ data: { pairs } }), { status: 200, headers: { 'Content-Type': 'application/json' } })) as unknown as typeof fetch;
  return new StonkFunClient({ fetchImpl });
}

describe('pair catalog', () => {
  test('xStock with LaunchLab ready is agent-launchable', () => {
    expect(toPairRow(FIXTURE[0]).agentLaunchable).toBe(true);
  });
  test('official ANSEM is launchable because it is pinned; the copycat is not', () => {
    expect(toPairRow(FIXTURE[1]).agentLaunchable).toBe(true);
    expect(toPairRow(FIXTURE[1]).pinned).toBe('ANSEM');
    expect(toPairRow(FIXTURE[2]).agentLaunchable).toBe(false);
  });
  test('SOL is never routed', () => {
    expect(toPairRow(FIXTURE[3]).agentLaunchable).toBe(false);
  });
  test('backpack normalizes to prestock', () => {
    expect(toPairRow(FIXTURE[4]).category).toBe('prestock');
    expect(toPairRow(FIXTURE[4]).agentLaunchable).toBe(true);
  });
  test('LaunchLab not ready blocks routing', () => {
    expect(toPairRow(FIXTURE[5]).agentLaunchable).toBe(false);
  });
  test('resolveQuote explains SOL routing', async () => {
    const client = fakeClient(FIXTURE);
    await expect(resolveQuote(client, FIXTURE[3].mint)).rejects.toBeInstanceOf(PairError);
    await expect(resolveQuote(client, FIXTURE[3].mint)).rejects.toThrow(/pump\.fun/);
  });
  test('resolveQuote returns the pinned ANSEM row', async () => {
    const row = await resolveQuote(fakeClient(FIXTURE), MINTS.ANSEM);
    expect(row.symbol).toBe('ANSEM');
  });
});
