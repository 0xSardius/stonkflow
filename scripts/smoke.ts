// Live smoke test against StonkFun's public API. Reads only; nothing is paid or signed.
// Run: bun run smoke
import { StonkFunClient } from '../src/stonkfun/client';
import { loadCatalog } from '../src/core/pairs';
import { MINTS } from '../src/config';

const client = new StonkFunClient();
const cat = await loadCatalog(client, { agentLaunchableOnly: true });
console.log(`pairs: ${cat.total} total, ${cat.agentLaunchableCount} agent-launchable`);
console.log('by category:', cat.byCategory);
const ansem = cat.pairs.find((p) => p.mint === MINTS.ANSEM);
console.log('ANSEM pinned row:', ansem ? { symbol: ansem.symbol, launchLabReady: ansem.launchLabReady, agentLaunchable: ansem.agentLaunchable } : 'MISSING');
const pricing = await client.getLaunchLabPricing(MINTS.ANSEM);
console.log('ANSEM LaunchLab pricing:', { startUsd: pricing.marketCap?.startUsd, graduationUsd: pricing.marketCap?.graduationUsd, platform: pricing.platform });
