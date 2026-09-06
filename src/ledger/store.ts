import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

// The ledger is the product's proof. Every launch, payment, buyback, forward,
// and claim is a row here and is rendered on /ledger. bun:sqlite keeps the
// MVP to one process; swap for Postgres by reimplementing this interface.

export interface LaunchRow {
  id: string;
  createdAt: string;
  idempotencyKey: string;
  signingMode: 'self' | 'managed';
  agentWallet: string;
  payerWallet: string | null;
  creatorWallet: string;
  quoteMint: string;
  quoteSymbol: string;
  quoteCategory: string;
  name: string;
  symbol: string;
  mode: 'standard' | 'reward';
  transferFeeBps: number | null;
  priceUsd: string | null;
  status: string;
  signedQuote: string;
  logo: string;
  expiresAt: string | null;
  paymentSignature: string | null;
  mint: string | null;
  pool: string | null;
  error: string | null;
}

export interface EventRow {
  id: number;
  ts: string;
  launchId: string | null;
  mint: string | null;
  kind: string;
  payload: string;
}

export interface Ledger {
  insertLaunch(row: Omit<LaunchRow, 'id' | 'createdAt' | 'paymentSignature' | 'mint' | 'pool' | 'error'>): Promise<LaunchRow>;
  update(id: string, patch: Partial<Pick<LaunchRow, 'status' | 'paymentSignature' | 'mint' | 'pool' | 'error'>>): Promise<void>;
  getLaunch(id: string): Promise<LaunchRow | null>;
  findByIdempotencyKey(key: string): Promise<LaunchRow | null>;
  findByMint(mint: string): Promise<LaunchRow | null>;
  countLaunchesSince(agentWallet: string, since: Date): Promise<number>;
  event(launchId: string, kind: string, payload: unknown): Promise<void>;
  eventForMint(mint: string, kind: string, payload: unknown): Promise<void>;
  recordFlow(kind: 'buyback' | 'forward' | 'x402_payment' | 'holder_payout', payload: unknown): Promise<void>;
  recentLaunches(limit?: number): Promise<LaunchRow[]>;
  recentEvents(limit?: number): Promise<EventRow[]>;
  summary(): Promise<LedgerSummary>;
}

export interface LedgerSummary {
  launches: number;
  completed: number;
  managed: number;
  self: number;
  distinctAgents: number;
  byQuote: Record<string, number>;
  buybacks: number;
  forwards: number;
}

export class SqliteLedger implements Ledger {
  private readonly db: Database;

  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path, { create: true });
    this.db.run('PRAGMA journal_mode = WAL');
    this.db.run(`CREATE TABLE IF NOT EXISTS launches (
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      idempotency_key TEXT NOT NULL UNIQUE,
      signing_mode TEXT NOT NULL,
      agent_wallet TEXT NOT NULL,
      payer_wallet TEXT,
      creator_wallet TEXT NOT NULL,
      quote_mint TEXT NOT NULL,
      quote_symbol TEXT NOT NULL,
      quote_category TEXT NOT NULL,
      name TEXT NOT NULL,
      symbol TEXT NOT NULL,
      mode TEXT NOT NULL,
      transfer_fee_bps INTEGER,
      price_usd TEXT,
      status TEXT NOT NULL,
      signed_quote TEXT NOT NULL,
      logo TEXT NOT NULL,
      expires_at TEXT,
      payment_signature TEXT,
      mint TEXT,
      pool TEXT,
      error TEXT
    )`);
    this.db.run(`CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts TEXT NOT NULL,
      launch_id TEXT,
      mint TEXT,
      kind TEXT NOT NULL,
      payload TEXT NOT NULL
    )`);
    this.db.run('CREATE INDEX IF NOT EXISTS launches_agent_created ON launches(agent_wallet, created_at)');
    this.db.run('CREATE INDEX IF NOT EXISTS events_ts ON events(ts)');
  }

  async insertLaunch(row: Omit<LaunchRow, 'id' | 'createdAt' | 'paymentSignature' | 'mint' | 'pool' | 'error'>): Promise<LaunchRow> {
    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    this.db
      .query(
        `INSERT INTO launches (id, created_at, idempotency_key, signing_mode, agent_wallet, payer_wallet, creator_wallet, quote_mint, quote_symbol, quote_category, name, symbol, mode, transfer_fee_bps, price_usd, status, signed_quote, logo, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id, createdAt, row.idempotencyKey, row.signingMode, row.agentWallet, row.payerWallet, row.creatorWallet,
        row.quoteMint, row.quoteSymbol, row.quoteCategory, row.name, row.symbol, row.mode, row.transferFeeBps,
        row.priceUsd, row.status, row.signedQuote, row.logo, row.expiresAt,
      );
    return (await this.getLaunch(id))!;
  }

  async update(id: string, patch: Partial<Pick<LaunchRow, 'status' | 'paymentSignature' | 'mint' | 'pool' | 'error'>>): Promise<void> {
    const sets: string[] = [];
    const vals: (string | null)[] = [];
    const map: Record<string, string> = { status: 'status', paymentSignature: 'payment_signature', mint: 'mint', pool: 'pool', error: 'error' };
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) continue;
      sets.push(`${map[k]} = ?`);
      vals.push(v as string | null);
    }
    if (!sets.length) return;
    this.db.query(`UPDATE launches SET ${sets.join(', ')} WHERE id = ?`).run(...vals, id);
  }

  async getLaunch(id: string): Promise<LaunchRow | null> {
    const r = this.db.query('SELECT * FROM launches WHERE id = ?').get(id) as Record<string, unknown> | null;
    return r ? toLaunchRow(r) : null;
  }

  async findByIdempotencyKey(key: string): Promise<LaunchRow | null> {
    const r = this.db.query('SELECT * FROM launches WHERE idempotency_key = ?').get(key) as Record<string, unknown> | null;
    return r ? toLaunchRow(r) : null;
  }

  async findByMint(mint: string): Promise<LaunchRow | null> {
    const r = this.db.query('SELECT * FROM launches WHERE mint = ?').get(mint) as Record<string, unknown> | null;
    return r ? toLaunchRow(r) : null;
  }

  async countLaunchesSince(agentWallet: string, since: Date): Promise<number> {
    const r = this.db.query('SELECT COUNT(*) AS n FROM launches WHERE agent_wallet = ? AND created_at >= ?').get(agentWallet, since.toISOString()) as { n: number };
    return r.n;
  }

  async event(launchId: string, kind: string, payload: unknown): Promise<void> {
    this.db.query('INSERT INTO events (ts, launch_id, mint, kind, payload) VALUES (?, ?, NULL, ?, ?)').run(new Date().toISOString(), launchId, kind, JSON.stringify(payload ?? {}));
  }

  async eventForMint(mint: string, kind: string, payload: unknown): Promise<void> {
    this.db.query('INSERT INTO events (ts, launch_id, mint, kind, payload) VALUES (?, NULL, ?, ?, ?)').run(new Date().toISOString(), mint, kind, JSON.stringify(payload ?? {}));
  }

  async recordFlow(kind: 'buyback' | 'forward' | 'x402_payment' | 'holder_payout', payload: unknown): Promise<void> {
    this.db.query('INSERT INTO events (ts, launch_id, mint, kind, payload) VALUES (?, NULL, NULL, ?, ?)').run(new Date().toISOString(), kind, JSON.stringify(payload ?? {}));
  }

  async recentLaunches(limit = 50): Promise<LaunchRow[]> {
    const rows = this.db.query('SELECT * FROM launches ORDER BY created_at DESC LIMIT ?').all(limit) as Record<string, unknown>[];
    return rows.map(toLaunchRow);
  }

  async recentEvents(limit = 100): Promise<EventRow[]> {
    const rows = this.db.query('SELECT id, ts, launch_id AS launchId, mint, kind, payload FROM events ORDER BY id DESC LIMIT ?').all(limit) as EventRow[];
    return rows;
  }

  async summary(): Promise<LedgerSummary> {
    const all = this.db.query('SELECT signing_mode, status, agent_wallet, quote_symbol FROM launches').all() as { signing_mode: string; status: string; agent_wallet: string; quote_symbol: string }[];
    const byQuote: Record<string, number> = {};
    const agents = new Set<string>();
    for (const r of all) {
      byQuote[r.quote_symbol] = (byQuote[r.quote_symbol] ?? 0) + 1;
      agents.add(r.agent_wallet);
    }
    const count = (kind: string) => (this.db.query('SELECT COUNT(*) AS n FROM events WHERE kind = ?').get(kind) as { n: number }).n;
    return {
      launches: all.length,
      completed: all.filter((r) => r.status === 'completed').length,
      managed: all.filter((r) => r.signing_mode === 'managed').length,
      self: all.filter((r) => r.signing_mode === 'self').length,
      distinctAgents: agents.size,
      byQuote,
      buybacks: count('buyback'),
      forwards: count('forward'),
    };
  }
}

function toLaunchRow(r: Record<string, unknown>): LaunchRow {
  return {
    id: r.id as string,
    createdAt: r.created_at as string,
    idempotencyKey: r.idempotency_key as string,
    signingMode: r.signing_mode as 'self' | 'managed',
    agentWallet: r.agent_wallet as string,
    payerWallet: (r.payer_wallet as string | null) ?? null,
    creatorWallet: r.creator_wallet as string,
    quoteMint: r.quote_mint as string,
    quoteSymbol: r.quote_symbol as string,
    quoteCategory: r.quote_category as string,
    name: r.name as string,
    symbol: r.symbol as string,
    mode: r.mode as 'standard' | 'reward',
    transferFeeBps: (r.transfer_fee_bps as number | null) ?? null,
    priceUsd: (r.price_usd as string | null) ?? null,
    status: r.status as string,
    signedQuote: r.signed_quote as string,
    logo: r.logo as string,
    expiresAt: (r.expires_at as string | null) ?? null,
    paymentSignature: (r.payment_signature as string | null) ?? null,
    mint: (r.mint as string | null) ?? null,
    pool: (r.pool as string | null) ?? null,
    error: (r.error as string | null) ?? null,
  };
}
