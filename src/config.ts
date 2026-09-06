// Single place for prices, pinned mints, and environment. Nothing else reads process.env.

const env = (k: string, fallback = ''): string => (process.env[k] ?? fallback).trim();

export const SERVICE = {
  name: 'StonkFlow',
  version: '0.1.0',
  description:
    'Launch coins paired with real assets (xStocks, pre-stocks, currencies, $ANSEM) from any agent. Reward coins pay holders in the quote asset on every trade.',
  publicUrl: env('PUBLIC_URL', 'http://localhost:3000'),
} as const;

/** Pinned mints. Never resolve ANSEM by symbol: StonkFun lists two "The Black Bull" mints. */
export const MINTS = {
  ANSEM: '9cRCn9rGT8V2imeM2BaKs13yhMEais3ruM3rPvTGpump',
  USDC: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  WSOL: 'So11111111111111111111111111111111111111112',
} as const;

/** StonkFun pair categories an agent may launch against. `solana` is excluded on purpose: SOL pairs go to pump.fun. */
export const AGENT_LAUNCHABLE_CATEGORIES = ['xstock', 'prestock', 'currency', 'leverage', 'custom'] as const;
export type LaunchableCategory = (typeof AGENT_LAUNCHABLE_CATEGORIES)[number];

/**
 * x402 prices in USD strings, keyed by route id. Static per route because the
 * x402 middleware needs the price at config time. Managed mode includes the
 * 0.03 SOL deploy fee the treasury pays; set MANAGED_LAUNCH_PRICE_USD from the
 * current SOL price before each deploy.
 */
export const PRICING = {
  launch_self: `$${env('SELF_LAUNCH_PRICE_USD', '1.00')}`,
  launch_self_holder: `$${env('SELF_LAUNCH_HOLDER_PRICE_USD', '0.50')}`,
  launch_managed: `$${env('MANAGED_LAUNCH_PRICE_USD', '8.00')}`,
  launch_managed_holder: `$${env('MANAGED_LAUNCH_HOLDER_PRICE_USD', '7.50')}`,
  claim_prepare: `$${env('CLAIM_PRICE_USD', '0.10')}`,
} as const;
export type PricedRoute = keyof typeof PRICING;

export const ROUTE_PATHS: Record<PricedRoute, string> = {
  launch_self: '/v1/launch/self',
  launch_self_holder: '/v1/launch/self/holder',
  launch_managed: '/v1/launch/managed',
  launch_managed_holder: '/v1/launch/managed/holder',
  claim_prepare: '/v1/fees/claim',
};

export const CONFIG = {
  port: Number(env('PORT', '3000')),
  stonkfun: {
    baseUrl: env('STONKFUN_API_BASE', 'https://www.stonkfun.xyz/api/public/v1'),
    /** StonkFun allows 25 prepare calls/min per IP. We queue above this. */
    preparePerMinute: 20,
  },
  solana: {
    rpcUrl: env('SOLANA_RPC_URL', 'https://api.mainnet-beta.solana.com'),
    /** CAIP-2 network id used by x402. */
    network: (env('PAYMENT_NETWORK') === 'devnet'
      ? 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1'
      : 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp') as `${string}:${string}`,
  },
  payments: {
    enabled: env('PAYMENTS_ENABLED').toLowerCase() === 'true',
    payTo: env('X402_PAY_TO_ADDRESS'),
    evmPayTo: env('EVM_PAY_TO'),
    /** Used when CDP keys are absent. PayAI is Solana-first. */
    facilitatorUrl: env('FACILITATOR_URL', 'https://facilitator.payai.network'),
    cdpKeyId: env('CDP_API_KEY_ID'),
    cdpKeySecret: env('CDP_API_KEY_SECRET'),
  },
  treasury: {
    /** base58 secret key or a JSON byte array. Managed-mode creator and buyback signer. */
    secret: env('TREASURY_SECRET_KEY'),
    /** Hard cap on what the hot wallet may hold, in SOL. Startup refuses above this. */
    maxSol: Number(env('TREASURY_MAX_SOL', '2')),
    /** Below this the managed route returns 503 instead of failing mid-launch. */
    minSolForLaunch: Number(env('TREASURY_MIN_SOL_FOR_LAUNCH', '0.06')),
  },
  entryToken: {
    /** The ClawPump entry token mint. Empty until it launches; holder routes stay off until then. */
    mint: env('ENTRY_TOKEN_MINT'),
    /** Whole tokens an agent wallet must hold for the holder price. */
    minBalance: Number(env('ENTRY_TOKEN_MIN_BALANCE', '10000')),
  },
  ledger: {
    dbPath: env('LEDGER_DB_PATH', './data/ledger.sqlite'),
  },
  limits: {
    launchesPerWalletPerHour: Number(env('LAUNCHES_PER_WALLET_PER_HOUR', '5')),
  },
  clawpump: {
    apiKey: env('CLAWPUMP_API_KEY'),
    apiBase: env('CLAWPUMP_API_BASE', 'https://agents.clawpump.tech/api/v1'),
  },
} as const;

/** Names and symbols a launch may not use. Small on purpose; the ledger attributes everything else. */
export const BLOCKED_NAME_PATTERNS: RegExp[] = [
  /\bofficial\b/i,
  /\bansem\b/i, // no impersonating the sponsor token
  /\bclawpump\b/i,
  /\bstonkfun\b/i,
  /\bpump\.?fun\b/i,
];
