import type { Services } from '../services';

// Buyback and forward job. Rule: a fixed share of router income (x402 fees +
// creator share on managed launches) buys the entry token and ANSEM 50/50 on
// a schedule, and the remainder of a managed launch's creator share is
// forwarded to the agent's payoutWallet. Every action is a ledger row.
//
// Not wired to a swap yet. The swap (Jupiter) lands after the entry token
// exists; until then the job only computes and records what it would do.

export interface BuybackPlan {
  buybackShareBps: number;
  entryTokenMint: string | null;
  ansemMint: string;
  dryRun: true;
}

export async function planBuyback(svc: Services, opts: { buybackShareBps: number; entryTokenMint: string | null; ansemMint: string }): Promise<BuybackPlan> {
  await svc.ledger.recordFlow('buyback', { dryRun: true, ...opts, note: 'swap not wired; recorded for the ledger' });
  return { ...opts, dryRun: true };
}
