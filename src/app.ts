import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Services } from './services';
import { v1Routes } from './routes/v1';
import { issueNonce } from './routes/holder';
import { CONFIG, PRICING, ROUTE_PATHS, SERVICE, type PricedRoute } from './config';
import { launchJsonSchema } from './schemas/launch';

// Builds the Hono app. x402 is applied here, on the paid paths only, before
// the v1 handlers. With PAYMENTS_ENABLED unset the same app serves everything
// free, which is how local development and tests run.

export async function buildApp(svc: Services): Promise<Hono> {
  const app = new Hono();

  app.use('*', cors({ origin: '*', allowMethods: ['GET', 'POST', 'OPTIONS'], allowHeaders: ['Content-Type', 'Accept', 'X-Payment', 'Payment-Signature', 'X-Wallet', 'X-Wallet-Signature'] }));

  app.get('/v1/nonce', (c) => {
    const wallet = c.req.query('wallet') ?? '';
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(wallet)) return c.json({ error: { code: 'invalid_request', message: 'wallet must be a base58 address' } }, 400);
    return c.json({ data: { wallet, nonce: issueNonce(wallet), expiresInSeconds: 300, sign: 'ed25519 detached over the UTF-8 nonce; send base58 in X-Wallet-Signature' } });
  });

  if (CONFIG.payments.enabled) {
    await mountX402(app, svc);
  } else {
    console.log('[x402] PAYMENTS_ENABLED is not true: all routes are free (dev mode)');
  }

  app.route('/', v1Routes(svc));
  return app;
}

async function mountX402(app: Hono, svc: Services) {
  const { paymentMiddleware, x402ResourceServer } = await import('@x402/hono');
  const { ExactSvmScheme } = await import('@x402/svm/exact/server');
  const { HTTPFacilitatorClient } = await import('@x402/core/server');
  const { declareDiscoveryExtension } = await import('@x402/extensions');

  if (!CONFIG.payments.payTo) throw new Error('PAYMENTS_ENABLED=true but X402_PAY_TO_ADDRESS is empty');

  // CDP facilitator when its keys exist (auto-lists on the bazaar); PayAI otherwise.
  let facilitatorConfig: any;
  if (CONFIG.payments.cdpKeyId && CONFIG.payments.cdpKeySecret) {
    const { facilitator } = await import('@coinbase/x402');
    facilitatorConfig = facilitator;
  } else {
    facilitatorConfig = { url: CONFIG.payments.facilitatorUrl };
  }
  const rs = new x402ResourceServer(new HTTPFacilitatorClient(facilitatorConfig)).register(CONFIG.solana.network, new ExactSvmScheme());
  if (CONFIG.payments.evmPayTo) {
    const { ExactEvmScheme } = await import('@x402/evm/exact/server');
    rs.register('eip155:8453', new ExactEvmScheme());
  }
  await rs.initialize();
  console.log(`[x402] facilitator ready (${CONFIG.payments.cdpKeyId ? 'CDP' : CONFIG.payments.facilitatorUrl})`);

  const DESCRIPTIONS: Record<PricedRoute, string> = {
    launch_self: 'Launch a coin paired with a real asset (xStock, pre-stock, currency, $ANSEM) on StonkFun. Returns an unsigned payment transaction for your wallet to sign; you are creator-of-record.',
    launch_self_holder: 'Holder price for launch_self. Requires X-Wallet and X-Wallet-Signature over a nonce from /v1/nonce.',
    launch_managed: 'Managed launch: StonkFlow signs as creator and forwards the creator share to your agentWallet. For hosted agents that cannot sign arbitrary transactions.',
    launch_managed_holder: 'Holder price for launch_managed. Requires X-Wallet and X-Wallet-Signature over a nonce from /v1/nonce.',
    claim_prepare: 'Prepare a creator fee claim on a standard-mode StonkFun launch. Returns an unsigned transaction for creatorWallet.',
  };
  const TAGS = ['solana', 'token-launch', 'stonkfun', 'xstocks', 'ai-agents'];
  const EXAMPLE = {
    agentWallet: 'vines1vzrYbzLMRdu58ou5XTby4qAqVRLmqo36NKPTg',
    quoteMint: '9cRCn9rGT8V2imeM2BaKs13yhMEais3ruM3rPvTGpump',
    name: 'Bull Dividend',
    symbol: 'BULLDIV',
    logo: 'data:image/png;base64,iVBORw0KGgo=',
    mode: 'reward',
    rewardTaxBps: '100',
    idempotencyKey: 'example-0001',
  };

  const routes: Record<string, unknown> = {};
  for (const key of Object.keys(PRICING) as PricedRoute[]) {
    routes[`POST ${ROUTE_PATHS[key]}`] = {
      accepts: [
        { scheme: 'exact', price: PRICING[key], network: CONFIG.solana.network, payTo: CONFIG.payments.payTo },
        ...(CONFIG.payments.evmPayTo ? [{ scheme: 'exact', price: PRICING[key], network: 'eip155:8453', payTo: CONFIG.payments.evmPayTo }] : []),
      ],
      resource: `${SERVICE.publicUrl}${ROUTE_PATHS[key]}`,
      serviceName: SERVICE.name,
      tags: TAGS,
      description: DESCRIPTIONS[key],
      mimeType: 'application/json',
      extensions: declareDiscoveryExtension({
        bodyType: 'json',
        input: key === 'claim_prepare' ? { mint: EXAMPLE.quoteMint, creatorWallet: EXAMPLE.agentWallet } : EXAMPLE,
        inputSchema: key === 'claim_prepare' ? { type: 'object', properties: { mint: { type: 'string' }, creatorWallet: { type: 'string' } }, required: ['mint', 'creatorWallet'] } : launchJsonSchema,
        output: { example: { data: { launchId: 'uuid', status: 'awaiting_signature | processing | completed' } } },
      }),
    };
  }

  const mw = paymentMiddleware(routes as any, rs);
  for (const key of Object.keys(PRICING) as PricedRoute[]) {
    app.use(ROUTE_PATHS[key], async (c, next) => {
      // Record the payer for attribution when the client sent a payment header.
      const header = c.req.header('payment-signature') ?? c.req.header('x-payment');
      if (header) {
        try {
          const decoded = JSON.parse(atob(header));
          const payer = decoded?.payload?.authorization?.from ?? decoded?.payload?.from ?? decoded?.payload?.signer;
          if (typeof payer === 'string') c.set('payerWallet' as never, payer as never);
        } catch { /* ignore */ }
      }
      return mw(c, next);
    });
  }
  void svc;
}
