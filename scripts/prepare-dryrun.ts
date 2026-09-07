// Calls StonkFun /launches/prepare with a throwaway keypair. Nothing is signed or submitted.
// Purpose: confirm the response field names in src/stonkfun/types.ts.
import { Keypair } from '@solana/web3.js';
import { StonkFunClient, StonkFunError } from '../src/stonkfun/client';
import { MINTS } from '../src/config';

// 1x1 transparent PNG
const LOGO = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const throwaway = Keypair.generate();
const client = new StonkFunClient();
try {
  const res = await client.prepareLaunch({
    creatorWallet: throwaway.publicKey.toBase58(),
    quoteMint: MINTS.ANSEM,
    name: 'Dryrun Dividend',
    symbol: 'DRYRUN',
    logo: LOGO,
    mode: 'reward',
    rewardTaxBps: '100',
  });
  const redact = (v: unknown) => (typeof v === 'string' && v.length > 60 ? `${v.slice(0, 24)}…(${v.length} chars)` : v);
  console.log('prepare OK. top-level keys:', Object.keys(res));
  for (const [k, v] of Object.entries(res)) console.log(` ${k}:`, typeof v === 'object' && v !== null ? JSON.stringify(v).slice(0, 300) : redact(v));
} catch (err) {
  if (err instanceof StonkFunError) console.log('prepare returned', err.status, err.code, err.message);
  else throw err;
}
