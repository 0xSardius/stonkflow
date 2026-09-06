import { AGENT_LAUNCHABLE_CATEGORIES, MINTS, type LaunchableCategory } from '../config';
import type { StonkPair } from '../stonkfun/types';
import type { StonkFunClient } from '../stonkfun/client';

export interface PairRow {
  mint: string;
  symbol: string;
  name: string;
  decimals: number;
  category: string;
  categoryLabel: string;
  tokenProgram: string;
  launchable: boolean;
  launchLabReady: boolean | null;
  symbolAmbiguous: boolean;
  /** true when an agent may route a launch to this quote through StonkFlow. */
  agentLaunchable: boolean;
  /** Set when the mint is one StonkFlow pins by hand (ANSEM, USDC). */
  pinned?: 'ANSEM' | 'USDC';
}

export function normalizeCategory(raw: string): string {
  const c = raw.toLowerCase();
  if (c === 'xstock' || c === 'xstocks') return 'xstock';
  if (c === 'prestock' || c === 'backpack' || c === 'prestocks') return 'prestock';
  return c;
}

export function toPairRow(p: StonkPair): PairRow {
  const category = normalizeCategory(p.category);
  const ready = typeof p.launchLabReady === 'boolean' ? p.launchLabReady : null;
  const pinned = p.mint === MINTS.ANSEM ? 'ANSEM' : p.mint === MINTS.USDC ? 'USDC' : undefined;
  return {
    mint: p.mint,
    symbol: p.symbol,
    name: p.name,
    decimals: p.decimals,
    category,
    categoryLabel: p.categoryLabel,
    tokenProgram: p.tokenProgram,
    launchable: p.launchable === true,
    launchLabReady: ready,
    symbolAmbiguous: p.symbolAmbiguous === true,
    agentLaunchable:
      p.launchable === true &&
      ready === true &&
      (AGENT_LAUNCHABLE_CATEGORIES as readonly string[]).includes(category) &&
      // A symbol that StonkFun itself marks ambiguous is only allowed when we pin the mint.
      (!p.symbolAmbiguous || pinned !== undefined),
    pinned,
  };
}

export interface PairCatalog {
  pairs: PairRow[];
  total: number;
  agentLaunchableCount: number;
  byCategory: Record<string, number>;
  allowedCategories: readonly LaunchableCategory[];
  ansemMint: string;
}

export async function loadCatalog(client: StonkFunClient, filters: { category?: string; agentLaunchableOnly?: boolean } = {}): Promise<PairCatalog> {
  const raw = await client.getPairs(true);
  const rows = raw.map(toPairRow);
  const byCategory: Record<string, number> = {};
  for (const r of rows) byCategory[r.category] = (byCategory[r.category] ?? 0) + 1;
  const wanted = filters.category ? normalizeCategory(filters.category) : null;
  const pairs = rows
    .filter((r) => !wanted || r.category === wanted)
    .filter((r) => !filters.agentLaunchableOnly || r.agentLaunchable)
    .sort(
      (a, b) =>
        Number(b.pinned !== undefined) - Number(a.pinned !== undefined) ||
        Number(b.agentLaunchable) - Number(a.agentLaunchable) ||
        a.category.localeCompare(b.category) ||
        a.symbol.localeCompare(b.symbol),
    );
  return {
    pairs,
    total: rows.length,
    agentLaunchableCount: rows.filter((r) => r.agentLaunchable).length,
    byCategory,
    allowedCategories: AGENT_LAUNCHABLE_CATEGORIES,
    ansemMint: MINTS.ANSEM,
  };
}

/** Resolve a quote mint an agent asked for. Throws when the mint is unknown or not routable. */
export async function resolveQuote(client: StonkFunClient, quoteMint: string): Promise<PairRow> {
  const catalog = await loadCatalog(client);
  const row = catalog.pairs.find((p) => p.mint === quoteMint);
  if (!row) throw new PairError('unknown_quote', `quoteMint ${quoteMint} is not a StonkFun pair`);
  if (!row.agentLaunchable) {
    const why =
      row.category === 'solana'
        ? 'SOL pairs are not routed through StonkFlow. Launch SOL-paired coins on pump.fun via ClawPump.'
        : !row.launchLabReady
          ? 'LaunchLab is not ready for this quote yet'
          : row.symbolAmbiguous
            ? 'symbol is ambiguous on StonkFun and the mint is not pinned'
            : `category ${row.category} is not agent-launchable`;
    throw new PairError('quote_not_routable', why);
  }
  return row;
}

export class PairError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'PairError';
    this.code = code;
  }
}
