import { CONFIG } from './config';
import { StonkFunClient } from './stonkfun/client';
import { LaunchCore } from './core/launch';
import { ClaimCore } from './core/claim';
import { loadCatalog, type PairCatalog } from './core/pairs';
import { SqliteLedger, type Ledger } from './ledger/store';
import { loadTreasury, type Signer } from './core/signer';

/** Everything the routes, MCP tools, and jobs share. Built once per process; built per test with overrides. */
export interface Services {
  stonkfun: StonkFunClient;
  ledger: Ledger;
  treasury: Signer | null;
  launchCore: LaunchCore;
  claimCore: ClaimCore;
  pairs(filters?: { category?: string; agentLaunchableOnly?: boolean }): Promise<PairCatalog>;
}

export function buildServices(overrides: Partial<Pick<Services, 'stonkfun' | 'ledger' | 'treasury'>> = {}): Services {
  const stonkfun = overrides.stonkfun ?? new StonkFunClient();
  const ledger = overrides.ledger ?? new SqliteLedger(process.env.NODE_ENV === 'test' ? ':memory:' : CONFIG.ledger.dbPath);
  const treasury = overrides.treasury !== undefined ? overrides.treasury : loadTreasury();
  const launchCore = new LaunchCore({ stonkfun, ledger, treasury });
  const claimCore = new ClaimCore({ stonkfun, ledger, treasury });
  return {
    stonkfun,
    ledger,
    treasury,
    launchCore,
    claimCore,
    pairs: (filters) => loadCatalog(stonkfun, filters),
  };
}
