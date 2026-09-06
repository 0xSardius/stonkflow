import { BLOCKED_NAME_PATTERNS, CONFIG, MINTS } from '../config';
import { StonkFunClient, StonkFunError } from '../stonkfun/client';
import type { PrepareLaunchRequest } from '../stonkfun/types';
import { resolveQuote, PairError } from './pairs';
import type { Signer } from './signer';
import { TreasuryLowError } from './signer';
import type { Ledger, LaunchRow } from '../ledger/store';
import bs58 from 'bs58';
import { VersionedTransaction, Transaction } from '@solana/web3.js';

// The router core. One code path for HTTP and MCP. Two signing modes:
//   self    -> the agent is creatorWallet; we return the unsigned payment tx and it signs.
//   managed -> the treasury is creatorWallet; we sign and submit; creator share is
//              forwarded to payoutWallet by the buyback/forward job and shown on the ledger.

export type SigningMode = 'self' | 'managed';

export interface LaunchInput {
  signingMode: SigningMode;
  /** self: the wallet that signs. managed: where creator fees are forwarded. */
  agentWallet: string;
  quoteMint: string;
  name: string;
  symbol: string;
  logo: string;
  mode: 'standard' | 'reward';
  rewardTaxBps?: '100' | '300';
  feeTier?: '1%' | '2%';
  website?: string;
  twitter?: string;
  telegram?: string;
  devBuyPercent?: number;
  devBuySol?: number;
  airdropPercent?: number;
  airdropTier?: 'top100' | 'top500' | 'top1000' | 'top5000';
  /** Caller-supplied idempotency key. Same key returns the same launch. */
  idempotencyKey: string;
  /** Wallet that paid the x402 charge, when known. Attribution only. */
  payerWallet?: string;
  priceUsd?: string;
}

export interface SelfLaunchResult {
  launchId: string;
  signingMode: 'self';
  status: 'awaiting_signature';
  creatorWallet: string;
  unsignedTransaction: string;
  signedQuote: string;
  expiresAt: string | null;
  transferFeeBps: number | null;
  next: string;
}

export interface ManagedLaunchResult {
  launchId: string;
  signingMode: 'managed';
  status: string;
  creatorWallet: string;
  payoutWallet: string;
  paymentSignature: string;
  mint: string | null;
  pool: string | null;
  transferFeeBps: number | null;
  next: string;
}

export class LaunchError extends Error {
  constructor(readonly code: string, message: string, readonly status = 400) {
    super(message);
    this.name = 'LaunchError';
  }
}

export interface LaunchCoreDeps {
  stonkfun: StonkFunClient;
  ledger: Ledger;
  treasury: Signer | null;
  now?: () => Date;
}

export class LaunchCore {
  private readonly prepareTimestamps: number[] = [];
  constructor(private readonly deps: LaunchCoreDeps) {}

  private now() {
    return (this.deps.now ?? (() => new Date()))();
  }

  /** Enforce StonkFun's 25/min prepare limit locally (we stop at 20). */
  private async throttlePrepare() {
    const cutoff = Date.now() - 60_000;
    while (this.prepareTimestamps.length && this.prepareTimestamps[0] < cutoff) this.prepareTimestamps.shift();
    if (this.prepareTimestamps.length >= CONFIG.stonkfun.preparePerMinute) {
      throw new LaunchError('rate_limited', 'StonkFlow is at the StonkFun prepare limit. Retry in 60 seconds.', 429);
    }
    this.prepareTimestamps.push(Date.now());
  }

  private validate(input: LaunchInput) {
    if (Buffer.byteLength(input.name) < 1 || Buffer.byteLength(input.name) > 32) throw new LaunchError('invalid_name', 'name must be 1-32 bytes');
    if (Buffer.byteLength(input.symbol) < 1 || Buffer.byteLength(input.symbol) > 10) throw new LaunchError('invalid_symbol', 'symbol must be 1-10 bytes');
    if (!/^data:image\/(png|jpeg|webp);base64,/.test(input.logo)) throw new LaunchError('invalid_logo', 'logo must be a data:image/(png|jpeg|webp);base64 URI');
    if (input.logo.length > 700_000) throw new LaunchError('invalid_logo', 'logo exceeds 512 KB');
    for (const re of BLOCKED_NAME_PATTERNS) {
      if (re.test(input.name) || re.test(input.symbol)) throw new LaunchError('blocked_name', `name or symbol matches a blocked pattern (${re.source})`);
    }
    if (input.mode === 'reward' && input.feeTier) throw new LaunchError('invalid_params', 'feeTier applies to standard mode only');
    if (input.mode === 'standard' && input.rewardTaxBps) throw new LaunchError('invalid_params', 'rewardTaxBps applies to reward mode only');
    if (input.devBuyPercent !== undefined && input.devBuySol !== undefined) throw new LaunchError('invalid_params', 'use devBuyPercent or devBuySol, not both');
    if (input.signingMode === 'managed' && input.devBuyPercent === undefined && input.devBuySol === undefined) {
      // fine: managed launches without a dev buy are the default
    }
    if (input.signingMode === 'managed' && (input.devBuyPercent || input.devBuySol)) {
      throw new LaunchError('invalid_params', 'managed launches do not run a dev buy from the treasury. Buy from the agent wallet after the pool exists (swap_execute on Raydium).');
    }
  }

  private async rateLimitWallet(wallet: string) {
    const n = await this.deps.ledger.countLaunchesSince(wallet, new Date(Date.now() - 3_600_000));
    if (n >= CONFIG.limits.launchesPerWalletPerHour) {
      throw new LaunchError('wallet_rate_limited', `wallet ${wallet} has reached ${CONFIG.limits.launchesPerWalletPerHour} launches this hour`, 429);
    }
  }

  async launch(input: LaunchInput): Promise<LaunchResult> {
    const existing = await this.deps.ledger.findByIdempotencyKey(input.idempotencyKey);
    if (existing) return this.replay(existing);

    this.validate(input);
    let quote;
    try {
      quote = await resolveQuote(this.deps.stonkfun, input.quoteMint);
    } catch (err) {
      if (err instanceof PairError) throw new LaunchError(err.code, err.message);
      throw err;
    }
    await this.rateLimitWallet(input.agentWallet);

    const creatorWallet = input.signingMode === 'self' ? input.agentWallet : this.requireTreasury().publicKey;
    if (input.signingMode === 'managed') {
      try {
        await this.requireTreasury().assertCanLaunch();
      } catch (err) {
        if (err instanceof TreasuryLowError) throw new LaunchError('treasury_low', 'managed launches are paused: treasury below floor', 503);
        throw err;
      }
    }

    const body: PrepareLaunchRequest = {
      creatorWallet,
      quoteMint: quote.mint,
      name: input.name,
      symbol: input.symbol,
      logo: input.logo,
      mode: input.mode,
      ...(input.rewardTaxBps ? { rewardTaxBps: input.rewardTaxBps } : {}),
      ...(input.feeTier ? { feeTier: input.feeTier } : {}),
      ...(input.website ? { website: input.website } : {}),
      ...(input.twitter ? { twitter: input.twitter } : {}),
      ...(input.telegram ? { telegram: input.telegram } : {}),
      ...(input.devBuyPercent !== undefined ? { devBuyPercent: input.devBuyPercent } : {}),
      ...(input.devBuySol !== undefined ? { devBuySol: input.devBuySol } : {}),
      ...(input.airdropPercent !== undefined ? { airdropPercent: input.airdropPercent, airdropTier: input.airdropTier ?? 'top100' } : {}),
    };

    await this.throttlePrepare();
    const prepared = await this.deps.stonkfun.prepareLaunch(body);
    const transferFeeBps = prepared.transferFee?.bps ?? null;

    const row = await this.deps.ledger.insertLaunch({
      idempotencyKey: input.idempotencyKey,
      signingMode: input.signingMode,
      agentWallet: input.agentWallet,
      payerWallet: input.payerWallet ?? null,
      creatorWallet,
      quoteMint: quote.mint,
      quoteSymbol: quote.symbol,
      quoteCategory: quote.category,
      name: input.name,
      symbol: input.symbol,
      mode: input.mode,
      transferFeeBps,
      priceUsd: input.priceUsd ?? null,
      status: 'awaiting_signature',
      signedQuote: prepared.signedQuote,
      logo: input.logo,
      expiresAt: prepared.expiresAt ?? null,
    });
    await this.deps.ledger.event(row.id, 'prepared', { creatorWallet, quote: quote.symbol, mode: input.mode, transferFeeBps });

    if (input.signingMode === 'self') {
      return {
        launchId: row.id,
        signingMode: 'self',
        status: 'awaiting_signature',
        creatorWallet,
        unsignedTransaction: prepared.paymentTransaction,
        signedQuote: prepared.signedQuote,
        expiresAt: prepared.expiresAt ?? null,
        transferFeeBps,
        next: `Sign unsignedTransaction with ${creatorWallet}, then POST /v1/launch/submit { launchId, signedTransaction }.`,
      };
    }

    const signed = this.requireTreasury().sign(prepared.paymentTransaction);
    return this.submitSigned(row, signed.signedBase64, signed.signature);
  }

  /** self mode step 2. The agent signed; relay to StonkFun. */
  async submit(launchId: string, signedTransaction: string): Promise<ManagedLaunchResult | SelfSubmitResult> {
    const row = await this.deps.ledger.getLaunch(launchId);
    if (!row) throw new LaunchError('not_found', `launch ${launchId} not found`, 404);
    if (row.status !== 'awaiting_signature') return this.replay(row);
    const signature = firstSignatureBase58(signedTransaction);
    return this.submitSigned(row, signedTransaction, signature);
  }

  private async submitSigned(row: LaunchRow, signedTransaction: string, paymentSignature: string) {
    await this.deps.ledger.update(row.id, { status: 'submitting', paymentSignature });
    try {
      const res = await this.deps.stonkfun.submitLaunch({ signedQuote: row.signedQuote, signedTransaction, logo: row.logo });
      const status = res.status === 'completed' ? 'completed' : 'processing';
      await this.deps.ledger.update(row.id, { status, mint: res.mint ?? null, pool: res.pool ?? null, paymentSignature: res.paymentSignature ?? paymentSignature });
      await this.deps.ledger.event(row.id, 'submitted', { status, mint: res.mint ?? null, pool: res.pool ?? null });
      return this.result({ ...row, status, mint: res.mint ?? null, pool: res.pool ?? null, paymentSignature: res.paymentSignature ?? paymentSignature });
    } catch (err) {
      if (err instanceof StonkFunError && err.isConflict) {
        // The payment already landed. Never re-pay. Mark processing and let status polling finish it.
        await this.deps.ledger.update(row.id, { status: 'processing', paymentSignature });
        await this.deps.ledger.event(row.id, 'conflict_payment_landed', { message: err.message });
        return this.result({ ...row, status: 'processing', paymentSignature });
      }
      if (err instanceof StonkFunError && err.isUnchargedUnavailable) {
        await this.deps.ledger.update(row.id, { status: 'failed_uncharged', error: err.message });
        await this.deps.ledger.event(row.id, 'bundle_missed_uncharged', { message: err.message });
        throw new LaunchError('bundle_missed', 'The launch bundle did not land. Nothing was charged. Prepare a fresh launch with a new idempotency key.', 503);
      }
      await this.deps.ledger.update(row.id, { status: 'failed', error: err instanceof Error ? err.message : String(err) });
      await this.deps.ledger.event(row.id, 'submit_failed', { message: err instanceof Error ? err.message : String(err) });
      throw err;
    }
  }

  async status(launchId: string) {
    const row = await this.deps.ledger.getLaunch(launchId);
    if (!row) throw new LaunchError('not_found', `launch ${launchId} not found`, 404);
    if (row.status === 'processing' && row.paymentSignature) {
      try {
        const live = await this.deps.stonkfun.getLaunch(row.paymentSignature);
        if (live.status === 'completed') {
          await this.deps.ledger.update(row.id, { status: 'completed', mint: live.mint ?? row.mint, pool: live.pool ?? row.pool });
          await this.deps.ledger.event(row.id, 'completed', { mint: live.mint ?? row.mint });
          return this.result({ ...row, status: 'completed', mint: live.mint ?? row.mint, pool: live.pool ?? row.pool });
        }
      } catch (err) {
        if (!(err instanceof StonkFunError && err.status === 404)) throw err;
      }
    }
    return this.result(row);
  }

  private replay(row: LaunchRow) {
    if (row.status === 'awaiting_signature' && row.signingMode === 'self') {
      throw new LaunchError('already_prepared', `launch ${row.id} is awaiting the agent signature. Submit it, or use a new idempotency key.`, 409);
    }
    return this.result(row);
  }

  private result(row: LaunchRow): ManagedLaunchResult | SelfSubmitResult {
    const base = {
      launchId: row.id,
      status: row.status,
      creatorWallet: row.creatorWallet,
      paymentSignature: row.paymentSignature ?? '',
      mint: row.mint ?? null,
      pool: row.pool ?? null,
      transferFeeBps: row.transferFeeBps,
      next:
        row.status === 'processing'
          ? `Poll GET /v1/launch/${row.id} until status is completed.`
          : row.status === 'completed'
            ? `Token ${row.mint} is live. Buy from the agent wallet on Raydium if you want a position; view the ledger at /ledger.`
            : 'See status.',
    };
    if (row.signingMode === 'managed') {
      return { ...base, signingMode: 'managed', payoutWallet: row.agentWallet };
    }
    return { ...base, signingMode: 'self' };
  }

  private requireTreasury(): Signer {
    if (!this.deps.treasury) throw new LaunchError('managed_unavailable', 'managed launches are not enabled on this deployment (no treasury)', 503);
    return this.deps.treasury;
  }
}

export type LaunchResult = SelfLaunchResult | ManagedLaunchResult | SelfSubmitResult;

export interface SelfSubmitResult {
  launchId: string;
  signingMode: 'self';
  status: string;
  creatorWallet: string;
  paymentSignature: string;
  mint: string | null;
  pool: string | null;
  transferFeeBps: number | null;
  next: string;
}

/** First signature of a signed base64 transaction, base58. Used as StonkFun's paymentSignature. */
export function firstSignatureBase58(signedBase64: string): string {
  const bytes = Buffer.from(signedBase64, 'base64');
  try {
    const vtx = VersionedTransaction.deserialize(bytes);
    if (!vtx.signatures.length) throw new Error('no signatures');
    return bs58.encode(vtx.signatures[0]);
  } catch {
    const tx = Transaction.from(bytes);
    const sig = tx.signatures[0]?.signature;
    if (!sig) throw new LaunchError('unsigned', 'signedTransaction carries no signature');
    return bs58.encode(sig);
  }
}

export { MINTS };
