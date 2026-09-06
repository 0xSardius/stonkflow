import { Connection, Keypair, LAMPORTS_PER_SOL, Transaction, VersionedTransaction } from '@solana/web3.js';
import bs58 from 'bs58';
import { CONFIG } from '../config';

// The only private key in the system: the treasury hot wallet. It signs
// managed-mode launches as creator-of-record and the buyback job. Its balance
// is capped at startup and checked before every managed launch.

export interface Signer {
  publicKey: string;
  /** Sign a base64 transaction (legacy or v0) and return base64 plus the first signature (base58). */
  sign(base64Tx: string): { signedBase64: string; signature: string };
  balanceSol(): Promise<number>;
  assertCanLaunch(): Promise<void>;
}

export function loadKeypair(secret: string): Keypair {
  const s = secret.trim();
  if (s.startsWith('[')) return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(s) as number[]));
  return Keypair.fromSecretKey(bs58.decode(s));
}

export function signBase64(keypair: Keypair, base64Tx: string): { signedBase64: string; signature: string } {
  const bytes = Buffer.from(base64Tx, 'base64');
  try {
    const vtx = VersionedTransaction.deserialize(bytes);
    vtx.sign([keypair]);
    return { signedBase64: Buffer.from(vtx.serialize()).toString('base64'), signature: bs58.encode(vtx.signatures[0]) };
  } catch {
    const tx = Transaction.from(bytes);
    tx.partialSign(keypair);
    const sig = tx.signatures.find((s) => s.publicKey.equals(keypair.publicKey))?.signature;
    if (!sig) throw new Error('treasury signature missing after partialSign');
    return { signedBase64: tx.serialize({ requireAllSignatures: false }).toString('base64'), signature: bs58.encode(sig) };
  }
}

export class TreasurySigner implements Signer {
  private readonly keypair: Keypair;
  private readonly connection: Connection;
  readonly publicKey: string;

  constructor(secret: string, rpcUrl: string) {
    this.keypair = loadKeypair(secret);
    this.connection = new Connection(rpcUrl, 'confirmed');
    this.publicKey = this.keypair.publicKey.toBase58();
  }

  sign(base64Tx: string) {
    return signBase64(this.keypair, base64Tx);
  }

  async balanceSol(): Promise<number> {
    const lamports = await this.connection.getBalance(this.keypair.publicKey);
    return lamports / LAMPORTS_PER_SOL;
  }

  /** Refuse to run above the cap (startup) and refuse to launch below the floor (per request). */
  async assertWithinCap(): Promise<void> {
    const bal = await this.balanceSol();
    if (bal > CONFIG.treasury.maxSol) {
      throw new Error(`treasury holds ${bal.toFixed(3)} SOL, above TREASURY_MAX_SOL=${CONFIG.treasury.maxSol}. Sweep the excess before starting.`);
    }
  }

  async assertCanLaunch(): Promise<void> {
    const bal = await this.balanceSol();
    if (bal < CONFIG.treasury.minSolForLaunch) {
      throw new TreasuryLowError(bal);
    }
  }
}

export class TreasuryLowError extends Error {
  constructor(readonly balanceSol: number) {
    super(`treasury balance ${balanceSol.toFixed(4)} SOL is below the launch floor`);
    this.name = 'TreasuryLowError';
  }
}

export function loadTreasury(): TreasurySigner | null {
  if (!CONFIG.treasury.secret) return null;
  return new TreasurySigner(CONFIG.treasury.secret, CONFIG.solana.rpcUrl);
}
