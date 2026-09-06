import { describe, expect, test } from 'bun:test';
import { Keypair, SystemProgram, Transaction, PublicKey } from '@solana/web3.js';
import { StonkFunClient } from '../src/stonkfun/client';
import { SqliteLedger } from '../src/ledger/store';
import { LaunchCore, LaunchError, firstSignatureBase58 } from '../src/core/launch';
import { signBase64 } from '../src/core/signer';
import type { Signer } from '../src/core/signer';
import { MINTS } from '../src/config';

// A fake StonkFun that records calls and can be told how to fail on submit.
function fakeStonkFun(opts: { submitStatus?: number; submitBody?: unknown } = {}) {
  const calls: { path: string; body: any }[] = [];
  const pairs = [
    { mint: MINTS.ANSEM, symbol: 'ANSEM', name: 'The Black Bull', decimals: 6, category: 'custom', categoryLabel: 'Custom', tokenProgram: 'T22', launchable: true, symbolAmbiguous: true, launchLabReady: true },
    { mint: 'Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh', symbol: 'NVDAX', name: 'NVIDIA', decimals: 8, category: 'xstock', categoryLabel: 'xStock', tokenProgram: 'T22', launchable: true, symbolAmbiguous: false, launchLabReady: true },
  ];
  const unsignedTx = (creator: string) => {
    const payer = new PublicKey(creator);
    const tx = new Transaction({ recentBlockhash: '11111111111111111111111111111111', feePayer: payer });
    tx.add(SystemProgram.transfer({ fromPubkey: payer, toPubkey: new PublicKey('11111111111111111111111111111111'), lamports: 1 }));
    return tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString('base64');
  };
  const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    const path = u.replace(/^https?:\/\/[^/]+\/api\/public\/v1/, '');
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ path, body });
    const ok = (data: unknown) => new Response(JSON.stringify({ data }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    if (path.startsWith('/pairs')) return ok({ pairs });
    if (path === '/launches/prepare') return ok({ signedQuote: 'q-1', paymentTransaction: unsignedTx(body.creatorWallet), expiresAt: '2026-09-07T00:00:00Z', transferFee: body.mode === 'reward' ? { bps: Number(body.rewardTaxBps ?? 100) } : null });
    if (path === '/launches/submit') {
      if (opts.submitStatus) return new Response(JSON.stringify(opts.submitBody ?? { error: { code: 'x', message: 'y' } }), { status: opts.submitStatus, headers: { 'Content-Type': 'application/json' } });
      return ok({ status: 'completed', mint: 'MintAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', pool: 'PoolAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' });
    }
    if (path.startsWith('/launches/')) return ok({ status: 'completed', mint: 'MintAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' });
    return new Response(JSON.stringify({ error: { code: 'not_found', message: path } }), { status: 404 });
  }) as unknown as typeof fetch;
  return { client: new StonkFunClient({ fetchImpl, baseUrl: 'https://fake/api/public/v1' }), calls };
}

const agent = Keypair.generate();
const treasuryKp = Keypair.generate();
const treasury: Signer = {
  publicKey: treasuryKp.publicKey.toBase58(),
  sign: (b64) => signBase64(treasuryKp, b64),
  balanceSol: async () => 1,
  assertCanLaunch: async () => {},
};

const LOGO = 'data:image/png;base64,iVBORw0KGgo=';
const input = (over: Partial<Parameters<LaunchCore['launch']>[0]> = {}) => ({
  signingMode: 'self' as const,
  agentWallet: agent.publicKey.toBase58(),
  quoteMint: MINTS.ANSEM,
  name: 'Bull Dividend',
  symbol: 'BULLDIV',
  logo: LOGO,
  mode: 'reward' as const,
  rewardTaxBps: '100' as const,
  idempotencyKey: `k-${Math.random()}`,
  ...over,
});

describe('LaunchCore self mode', () => {
  test('prepare returns unsigned tx; submit completes; status is idempotent', async () => {
    const { client, calls } = fakeStonkFun();
    const core = new LaunchCore({ stonkfun: client, ledger: new SqliteLedger(':memory:'), treasury: null });
    const key = 'k-self-1';
    const prepared = await core.launch(input({ idempotencyKey: key }));
    expect(prepared.signingMode).toBe('self');
    expect(prepared.status).toBe('awaiting_signature');
    if (!('unsignedTransaction' in prepared)) throw new Error('unexpected');
    expect(prepared.creatorWallet).toBe(agent.publicKey.toBase58());
    expect(calls.find((c) => c.path === '/launches/prepare')!.body.creatorWallet).toBe(agent.publicKey.toBase58());

    // replay with the same key before signing -> 409 style error, no second prepare
    await expect(core.launch(input({ idempotencyKey: key }))).rejects.toBeInstanceOf(LaunchError);
    expect(calls.filter((c) => c.path === '/launches/prepare').length).toBe(1);

    const signed = signBase64(agent, prepared.unsignedTransaction);
    const done = await core.submit(prepared.launchId, signed.signedBase64);
    expect(done.status).toBe('completed');
    expect(done.mint).toMatch(/^Mint/);
    expect(done.paymentSignature).toBe(signed.signature);

    const again = await core.status(prepared.launchId);
    expect(again.status).toBe('completed');
  });

  test('409 on submit marks processing and never re-pays', async () => {
    const { client, calls } = fakeStonkFun({ submitStatus: 409, submitBody: { error: { code: 'conflict', message: 'payment already landed' } } });
    const core = new LaunchCore({ stonkfun: client, ledger: new SqliteLedger(':memory:'), treasury: null });
    const prepared = await core.launch(input());
    if (!('unsignedTransaction' in prepared)) throw new Error('unexpected');
    const signed = signBase64(agent, prepared.unsignedTransaction);
    const res = await core.submit(prepared.launchId, signed.signedBase64);
    expect(res.status).toBe('processing');
    expect(calls.filter((c) => c.path === '/launches/submit').length).toBe(1);
  });

  test('503 charged:false fails uncharged with a clear code', async () => {
    const { client } = fakeStonkFun({ submitStatus: 503, submitBody: { error: { code: 'service_unavailable', message: 'bundle missed' }, charged: false } });
    const core = new LaunchCore({ stonkfun: client, ledger: new SqliteLedger(':memory:'), treasury: null });
    const prepared = await core.launch(input());
    if (!('unsignedTransaction' in prepared)) throw new Error('unexpected');
    const signed = signBase64(agent, prepared.unsignedTransaction);
    await expect(core.submit(prepared.launchId, signed.signedBase64)).rejects.toMatchObject({ code: 'bundle_missed', status: 503 });
  });

  test('blocked names and SOL quotes are rejected before any StonkFun call', async () => {
    const { client, calls } = fakeStonkFun();
    const core = new LaunchCore({ stonkfun: client, ledger: new SqliteLedger(':memory:'), treasury: null });
    await expect(core.launch(input({ name: 'Official ANSEM' }))).rejects.toMatchObject({ code: 'blocked_name' });
    await expect(core.launch(input({ quoteMint: 'So11111111111111111111111111111111111111112' }))).rejects.toMatchObject({ code: 'unknown_quote' });
    expect(calls.filter((c) => c.path === '/launches/prepare').length).toBe(0);
  });
});

describe('LaunchCore managed mode', () => {
  test('treasury is creator, agent is payout, submit happens in one call', async () => {
    const { client, calls } = fakeStonkFun();
    const core = new LaunchCore({ stonkfun: client, ledger: new SqliteLedger(':memory:'), treasury });
    const res = await core.launch(input({ signingMode: 'managed' }));
    expect(res.signingMode).toBe('managed');
    if (res.signingMode !== 'managed') throw new Error('unexpected');
    expect(res.creatorWallet).toBe(treasury.publicKey);
    expect(res.payoutWallet).toBe(agent.publicKey.toBase58());
    expect(res.status).toBe('completed');
    expect(calls.find((c) => c.path === '/launches/prepare')!.body.creatorWallet).toBe(treasury.publicKey);
    expect(calls.find((c) => c.path === '/launches/submit')!.body.signedQuote).toBe('q-1');
  });

  test('managed without a treasury returns 503', async () => {
    const { client } = fakeStonkFun();
    const core = new LaunchCore({ stonkfun: client, ledger: new SqliteLedger(':memory:'), treasury: null });
    await expect(core.launch(input({ signingMode: 'managed' }))).rejects.toMatchObject({ code: 'managed_unavailable', status: 503 });
  });

  test('managed rejects a dev buy', async () => {
    const { client } = fakeStonkFun();
    const core = new LaunchCore({ stonkfun: client, ledger: new SqliteLedger(':memory:'), treasury });
    await expect(core.launch(input({ signingMode: 'managed', devBuyPercent: 5 }))).rejects.toMatchObject({ code: 'invalid_params' });
  });
});

describe('firstSignatureBase58', () => {
  test('reads the signature from a legacy signed tx', () => {
    const tx = new Transaction({ recentBlockhash: '11111111111111111111111111111111', feePayer: agent.publicKey });
    tx.add(SystemProgram.transfer({ fromPubkey: agent.publicKey, toPubkey: new PublicKey('11111111111111111111111111111111'), lamports: 1 }));
    tx.sign(agent);
    const b64 = tx.serialize().toString('base64');
    expect(firstSignatureBase58(b64).length).toBeGreaterThan(80);
  });
});
