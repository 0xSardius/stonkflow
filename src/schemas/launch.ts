import { z } from 'zod';

const base58 = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/, 'expected a base58 Solana address');

export const LaunchBody = z.object({
  agentWallet: base58.describe('self: the wallet that will sign. managed: where the creator share is forwarded.'),
  quoteMint: base58.describe('Quote asset mint from GET /v1/pairs. Use the pinned ANSEM mint for ANSEM.'),
  name: z.string().min(1).max(32),
  symbol: z.string().min(1).max(10),
  logo: z.string().describe('data:image/(png|jpeg|webp);base64,... up to 512 KB'),
  mode: z.enum(['standard', 'reward']).default('reward'),
  rewardTaxBps: z.enum(['100', '300']).optional().describe('reward mode: 1% or 3% transfer tax paid to holders in the quote asset'),
  feeTier: z.enum(['1%', '2%']).optional().describe('standard mode: creator earns 0.5% (1%) or 1.5% (2%) of volume'),
  website: z.string().url().optional(),
  twitter: z.string().max(64).optional(),
  telegram: z.string().max(64).optional(),
  devBuyPercent: z.number().min(0).max(50).optional(),
  devBuySol: z.number().min(0).optional(),
  airdropPercent: z.number().min(0).max(50).optional(),
  airdropTier: z.enum(['top100', 'top500', 'top1000', 'top5000']).optional(),
  idempotencyKey: z.string().min(8).max(128),
});
export type LaunchBody = z.infer<typeof LaunchBody>;

export const SubmitBody = z.object({
  launchId: z.string().min(1),
  signedTransaction: z.string().min(1).describe('base64, signed by agentWallet'),
});

export const ClaimPrepareBody = z.object({
  mint: base58,
  creatorWallet: base58,
});

export const ClaimSubmitBody = z.object({
  mint: base58,
  creatorWallet: base58,
  intentId: z.string().min(1),
  signedTransaction: z.string().min(1),
});

export const PairsQuery = z.object({
  category: z.string().optional(),
  agentLaunchableOnly: z.coerce.boolean().optional().default(true),
});

/** JSON Schema for the 402 discovery extension and MCP tool listings. */
export const launchJsonSchema = z.toJSONSchema(LaunchBody, { io: 'input' }) as Record<string, unknown>;
