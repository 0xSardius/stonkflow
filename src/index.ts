import { buildApp } from './app';
import { buildServices } from './services';
import { CONFIG, SERVICE } from './config';
import { TreasurySigner } from './core/signer';

const svc = buildServices();

if (svc.treasury instanceof TreasurySigner) {
  await svc.treasury.assertWithinCap();
  console.log(`[treasury] ${svc.treasury.publicKey} (managed launches enabled, cap ${CONFIG.treasury.maxSol} SOL)`);
} else {
  console.log('[treasury] no TREASURY_SECRET_KEY: managed launches disabled, self mode only');
}

const app = await buildApp(svc);
console.log(`${SERVICE.name} v${SERVICE.version} listening on :${CONFIG.port}`);

export default {
  port: CONFIG.port,
  hostname: '0.0.0.0',
  maxRequestBodySize: 1_048_576,
  idleTimeout: 60,
  fetch: app.fetch,
};
