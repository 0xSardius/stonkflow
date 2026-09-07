// StonkFun public API shapes. Reads mirror ../solenrich/src/sources/stonkfun.ts.
// Write shapes are typed loosely: the OpenAPI spec declares `data: object`
// for them. Field names below come from the endpoint descriptions and are
// verified on the first live call (see docs/CHECKPOINT.md).

export type StonkMode = 'standard' | 'reward';

export interface StonkPair {
  mint: string;
  symbol: string;
  name: string;
  decimals: number;
  logoUrl?: string;
  category: string;
  categoryLabel: string;
  tokenProgram: string;
  launchable: boolean;
  symbolAmbiguous?: boolean;
  launchLabReady?: boolean;
}

export interface StonkQuoteRef {
  mint: string;
  symbol: string;
  name?: string;
  category?: string;
  decimals?: number;
}

export interface StonkToken {
  mint: string;
  pool: string;
  name: string;
  symbol: string;
  quote: StonkQuoteRef;
  launchpad: string;
  mode: StonkMode;
  transferFee?: { bps: number } | null;
  flywheel?: { active: boolean } | null;
  market: { priceUsd: number; marketCapUsd: number; volume24hUsd: number; priceChange24h?: number };
  status: string;
  createdAt: string;
}

export interface StonkLaunchRecord {
  mint: string;
  pool: string;
  name: string;
  symbol: string;
  creator: string;
  quote: { mint: string; symbol: string };
  launchpad: string;
  mode: StonkMode;
  createdAt: string;
}

/** POST /launches/prepare request. */
export interface PrepareLaunchRequest {
  creatorWallet: string;
  quoteMint: string;
  name: string;
  symbol: string;
  /** data:image/(png|jpeg|webp);base64,... up to 512 KB */
  logo: string;
  mode?: StonkMode;
  /** reward mode only: '100' or '300' */
  rewardTaxBps?: '100' | '300';
  /** standard mode only: '1%' (default) or '2%' */
  feeTier?: '1%' | '2%';
  website?: string;
  twitter?: string;
  telegram?: string;
  devBuyPercent?: number;
  devBuySol?: number;
  airdropPercent?: number;
  airdropTier?: 'top100' | 'top500' | 'top1000' | 'top5000';
  airdropSource?: string;
}

/** POST /launches/prepare response `data`. */
export interface PrepareLaunchResponse {
  signedQuote: string;
  /** Unsigned SOL payment transaction, base64. Named per the /submit description. */
  paymentTransaction: string;
  expiresAt?: string;
  /** Verified live 2026-09-06: the platform launch fee the creator pays in SOL (0.2904 SOL on the API path). */
  payment?: { to: string; lamports: number; sol: number; feeLamports: number; feeSol: number };
  mode?: StonkMode;
  poolFeePercent?: number;
  transferFee?: { bps: number } | null;
  devBuy?: Record<string, unknown> | null;
  airdrop?: Record<string, unknown> | null;
  [k: string]: unknown;
}

export interface SubmitLaunchRequest {
  signedQuote: string;
  signedTransaction: string;
  logo: string;
}

export interface SubmitLaunchResponse {
  status: 'completed' | 'processing' | string;
  mint?: string;
  pool?: string;
  paymentSignature?: string;
  [k: string]: unknown;
}

export interface LaunchStatusResponse {
  status: 'completed' | 'processing' | 'failed' | string;
  mint?: string;
  pool?: string;
  [k: string]: unknown;
}

export interface ClaimableFees {
  claimable: null | { base?: Record<string, unknown>; quote?: Record<string, unknown>; [k: string]: unknown };
  reason?: string;
  [k: string]: unknown;
}

export interface PrepareClaimResponse {
  intentId: string;
  /** Unsigned claim transaction, base64. */
  transaction: string;
  amounts?: Record<string, unknown>;
  [k: string]: unknown;
}

export interface SubmitClaimResponse {
  signature: string;
  alreadySubmitted?: boolean;
  [k: string]: unknown;
}

export interface StonkLaunchLabPricing {
  quote: { mint: string; symbol: string; decimals: number; tokenProgram: string };
  marketCap: { startUsd: number; graduationUsd: number };
  prices: { solUsd: number; quoteUsd: number; observedAt: string };
  platform: { standard: string; reward: string };
  [k: string]: unknown;
}
