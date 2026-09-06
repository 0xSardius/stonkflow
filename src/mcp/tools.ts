import { z } from 'zod';
import { LaunchBody, SubmitBody, ClaimPrepareBody, ClaimSubmitBody } from '../schemas/launch';
import type { Services } from '../services';
import { ROUTE_PATHS, PRICING, SERVICE, MINTS } from '../config';
import { LaunchError } from '../core/launch';

// MCP tools are declared as data so the stateless HTTP dispatcher allocates
// nothing per request (pattern from ../solenrich/src/mcp-tools.ts).
//
// Reads call the core directly. Paid writes go through the HTTP route so x402
// is enforced on one path only; the tool surfaces the 402 challenge as text so
// a self-hosted agent knows exactly what to pay. Hosted ClawPump agents use
// `x402_pay` against the same URL instead of this MCP.

export interface ToolDef {
  name: string;
  title: string;
  description: string;
  inputSchema: z.ZodRawShape;
  handler: (input: Record<string, unknown>, svc: Services) => Promise<string>;
}

const json = (v: unknown) => JSON.stringify(v, null, 2);

async function callPaidRoute(path: string, body: unknown): Promise<string> {
  const url = `${SERVICE.publicUrl}${path}`;
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (res.status === 402) {
    let hint = '';
    const header = res.headers.get('payment-required');
    if (header) {
      try {
        const decoded = JSON.parse(atob(header));
        const a = decoded.accepts?.[0];
        if (a) hint = `\nAmount: ${a.amount} base units USDC on ${a.network}, pay to ${a.payTo}.`;
      } catch { /* ignore */ }
    }
    const text = await res.text();
    return `Payment required. POST ${url} with an x402 payment header (USDC on Solana).${hint}\n${text}`;
  }
  return await res.text();
}

export const MCP_TOOLS: ToolDef[] = [
  {
    name: 'stonkflow_pairs',
    title: 'List launchable quote assets',
    description:
      'Quote assets an agent can launch a coin against through StonkFlow: xStocks (NVDAX, TSLAX, SPYX...), pre-IPO stocks, currencies (USDC, EURC), and pinned custom mints including $ANSEM. SOL pairs are NOT routed here: launch SOL-paired coins on pump.fun via ClawPump. Free.',
    inputSchema: {
      category: z.enum(['xstock', 'prestock', 'currency', 'leverage', 'custom']).optional().describe('Filter by category'),
      agentLaunchableOnly: z.boolean().optional().default(true),
    },
    handler: async (input, svc) => {
      const cat = await svc.pairs({ category: input.category as string | undefined, agentLaunchableOnly: input.agentLaunchableOnly !== false });
      return json({
        ansemMint: MINTS.ANSEM,
        agentLaunchableCount: cat.agentLaunchableCount,
        byCategory: cat.byCategory,
        pairs: cat.pairs.slice(0, 120).map((p) => ({ mint: p.mint, symbol: p.symbol, name: p.name, category: p.category, pinned: p.pinned ?? null })),
      });
    },
  },
  {
    name: 'stonkflow_launch',
    title: 'Launch a coin paired with a real asset',
    description:
      `Launch a coin on StonkFun priced in a quote asset (use stonkflow_pairs). Reward mode (default) bakes a 1% or 3% transfer tax into the coin that is paid to ALL holders in the quote asset on every trade; standard mode pays the creator 0.5% of volume instead. signingMode self: you receive an unsigned payment transaction to sign with agentWallet, then call stonkflow_submit. signingMode managed: StonkFlow signs as creator and forwards the creator share to agentWallet. Paid via x402: self ${PRICING.launch_self}, managed ${PRICING.launch_managed}.`,
    inputSchema: {
      signingMode: z.enum(['self', 'managed']).default('self'),
      ...LaunchBody.shape,
    },
    handler: async (input) => {
      const { signingMode, ...body } = input as { signingMode: 'self' | 'managed' } & Record<string, unknown>;
      const path = signingMode === 'managed' ? ROUTE_PATHS.launch_managed : ROUTE_PATHS.launch_self;
      return callPaidRoute(path, body);
    },
  },
  {
    name: 'stonkflow_submit',
    title: 'Submit a signed launch',
    description: 'Self mode step 2. Relay the payment transaction you signed with agentWallet. Free. Returns completed or processing; poll stonkflow_status on processing. Never sign and submit the same launch twice.',
    inputSchema: SubmitBody.shape,
    handler: async (input, svc) => {
      const parsed = SubmitBody.parse(input);
      return json(await svc.launchCore.submit(parsed.launchId, parsed.signedTransaction));
    },
  },
  {
    name: 'stonkflow_status',
    title: 'Launch status',
    description: 'Status of a launch by launchId. Free. completed returns the mint and pool.',
    inputSchema: { launchId: z.string() },
    handler: async (input, svc) => json(await svc.launchCore.status(String(input.launchId))),
  },
  {
    name: 'stonkflow_claim',
    title: 'Prepare a creator fee claim',
    description: `Standard-mode launches only. Returns an unsigned claim transaction for creatorWallet; sign it and call stonkflow_claim_submit. LaunchLab launches forward fees automatically, so most claims answer nothing-to-claim. Paid via x402: ${PRICING.claim_prepare}.`,
    inputSchema: ClaimPrepareBody.shape,
    handler: async (input) => callPaidRoute(ROUTE_PATHS.claim_prepare, input),
  },
  {
    name: 'stonkflow_claim_submit',
    title: 'Submit a signed fee claim',
    description: 'Relay a signed claim transaction. Free. Idempotent per intentId.',
    inputSchema: ClaimSubmitBody.shape,
    handler: async (input, svc) => {
      const p = ClaimSubmitBody.parse(input);
      return json(await svc.claimCore.submit(p.mint, { creatorWallet: p.creatorWallet, intentId: p.intentId, signedTransaction: p.signedTransaction }));
    },
  },
];

export function describeToolError(err: unknown): string {
  if (err instanceof LaunchError) return `${err.code}: ${err.message}`;
  if (err instanceof z.ZodError) return `invalid_input: ${err.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`;
  return err instanceof Error ? err.message : String(err);
}
