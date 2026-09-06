import type { MiddlewareHandler } from 'hono';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { Connection, PublicKey } from '@solana/web3.js';
import { CONFIG } from '../config';
import type { Services } from '../services';

// Holder pricing. The agent proves it controls a wallet by signing a server
// nonce, and the server checks that wallet's entry-token balance. Only then
// does the request reach the cheaper x402-priced route. Nonces are single use
// and expire in 5 minutes.

const NONCES = new Map<string, { nonce: string; expiry: number }>();
const NONCE_TTL_MS = 5 * 60_000;

export function issueNonce(wallet: string): string {
  const nonce = `stonkflow:${wallet}:${crypto.randomUUID()}`;
  NONCES.set(wallet, { nonce, expiry: Date.now() + NONCE_TTL_MS });
  return nonce;
}

export function verifyHolderProof(wallet: string, signatureB58: string): boolean {
  const entry = NONCES.get(wallet);
  if (!entry || entry.expiry < Date.now()) return false;
  NONCES.delete(wallet);
  try {
    const pub = bs58.decode(wallet);
    const sig = bs58.decode(signatureB58);
    return nacl.sign.detached.verify(new TextEncoder().encode(entry.nonce), sig, pub);
  } catch {
    return false;
  }
}

export async function entryTokenBalance(wallet: string, rpcUrl = CONFIG.solana.rpcUrl): Promise<number> {
  if (!CONFIG.entryToken.mint) return 0;
  const conn = new Connection(rpcUrl, 'confirmed');
  const res = await conn.getParsedTokenAccountsByOwner(new PublicKey(wallet), { mint: new PublicKey(CONFIG.entryToken.mint) });
  let total = 0;
  for (const acc of res.value) {
    const ui = (acc.account.data as any)?.parsed?.info?.tokenAmount?.uiAmount;
    if (typeof ui === 'number') total += ui;
  }
  return total;
}

export function holderGate(_svc: Services, deps: { balance?: (wallet: string) => Promise<number> } = {}): MiddlewareHandler {
  const balance = deps.balance ?? entryTokenBalance;
  return async (c, next) => {
    if (!CONFIG.entryToken.mint) {
      return c.json({ error: { code: 'holder_pricing_unavailable', message: 'The entry token has not launched yet. Use the standard route.' } }, 503);
    }
    const wallet = c.req.header('x-wallet') ?? '';
    const sig = c.req.header('x-wallet-signature') ?? '';
    if (!wallet || !sig) return c.json({ error: { code: 'holder_proof_required', message: 'Send X-Wallet and X-Wallet-Signature over a nonce from GET /v1/nonce?wallet=' } }, 401);
    if (!verifyHolderProof(wallet, sig)) return c.json({ error: { code: 'holder_proof_invalid', message: 'signature did not verify or nonce expired' } }, 401);
    const bal = await balance(wallet);
    if (bal < CONFIG.entryToken.minBalance) {
      return c.json({ error: { code: 'not_a_holder', message: `wallet holds ${bal} entry tokens; ${CONFIG.entryToken.minBalance} required` } }, 403);
    }
    c.set('holderWallet', wallet);
    await next();
  };
}
