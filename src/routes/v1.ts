import { Hono } from 'hono';
import { z } from 'zod';
import type { Services } from '../services';
import { LaunchBody, SubmitBody, ClaimPrepareBody, ClaimSubmitBody, PairsQuery } from '../schemas/launch';
import { LaunchError } from '../core/launch';
import { StonkFunError } from '../stonkfun/client';
import { PRICING, ROUTE_PATHS, SERVICE, MINTS, CONFIG } from '../config';
import { renderLedgerPage } from '../ledger/page';
import { dispatchMcp, MCP_PARSE_ERROR } from '../mcp/http';
import { holderGate } from './holder';

// One code path: every route calls the core. x402 middleware is applied in app.ts
// on the paid paths listed in ROUTE_PATHS before these handlers run.

export function v1Routes(svc: Services) {
  const app = new Hono();

  app.get('/', (c) =>
    c.json({
      service: SERVICE.name,
      version: SERVICE.version,
      description: SERVICE.description,
      pricing: PRICING,
      routes: {
        pairs: 'GET /v1/pairs (free)',
        launch_self: `POST ${ROUTE_PATHS.launch_self} (x402 ${PRICING.launch_self}) -> unsigned tx for agentWallet to sign`,
        launch_managed: `POST ${ROUTE_PATHS.launch_managed} (x402 ${PRICING.launch_managed}) -> StonkFlow signs as creator, forwards creator share to agentWallet`,
        holder_prices: `POST ${ROUTE_PATHS.launch_self_holder} / ${ROUTE_PATHS.launch_managed_holder} with X-Wallet + X-Wallet-Signature (entry-token holders)`,
        submit: 'POST /v1/launch/submit (free)',
        status: 'GET /v1/launch/:id (free)',
        claim: `POST ${ROUTE_PATHS.claim_prepare} (x402 ${PRICING.claim_prepare}), POST /v1/fees/claim/submit (free)`,
        ledger: 'GET /ledger (html), GET /v1/ledger.json',
        mcp: 'POST /mcp',
        nonce: 'GET /v1/nonce?wallet=... (holder proof)',
      },
      pinned: { ANSEM: MINTS.ANSEM, USDC: MINTS.USDC },
      routing_rule: 'SOL pairs go to pump.fun (ClawPump launch tools). Asset pairs come here.',
    }),
  );

  app.get('/health', async (c) => {
    const treasury = svc.treasury ? { publicKey: svc.treasury.publicKey } : null;
    return c.json({ ok: true, service: SERVICE.name, version: SERVICE.version, payments: CONFIG.payments.enabled, managed: treasury !== null, ts: new Date().toISOString() });
  });

  app.get('/v1/pairs', async (c) => {
    const q = PairsQuery.parse({ category: c.req.query('category'), agentLaunchableOnly: c.req.query('agentLaunchableOnly') ?? 'true' });
    const cat = await svc.pairs({ category: q.category, agentLaunchableOnly: q.agentLaunchableOnly });
    c.header('Cache-Control', 'public, max-age=60');
    return c.json({ data: cat, meta: { generatedAt: new Date().toISOString() } });
  });

  const launchHandler = (signingMode: 'self' | 'managed', priceKey: keyof typeof PRICING) => async (c: any) => {
    const body = LaunchBody.parse(await c.req.json());
    const payerWallet = c.get('payerWallet') as string | undefined;
    const result = await svc.launchCore.launch({ ...body, signingMode, payerWallet, priceUsd: PRICING[priceKey] });
    await svc.ledger.recordFlow('x402_payment', { route: priceKey, price: PRICING[priceKey], payerWallet: payerWallet ?? null, launchId: result.launchId });
    return c.json({ data: result }, result.status === 'awaiting_signature' ? 200 : 201);
  };

  app.post(ROUTE_PATHS.launch_self, launchHandler('self', 'launch_self'));
  app.post(ROUTE_PATHS.launch_managed, launchHandler('managed', 'launch_managed'));
  app.post(ROUTE_PATHS.launch_self_holder, holderGate(svc), launchHandler('self', 'launch_self_holder'));
  app.post(ROUTE_PATHS.launch_managed_holder, holderGate(svc), launchHandler('managed', 'launch_managed_holder'));

  app.post('/v1/launch/submit', async (c) => {
    const body = SubmitBody.parse(await c.req.json());
    return c.json({ data: await svc.launchCore.submit(body.launchId, body.signedTransaction) });
  });

  app.get('/v1/launch/:id', async (c) => c.json({ data: await svc.launchCore.status(c.req.param('id')) }));

  app.get('/v1/fees/:mint', async (c) => c.json({ data: await svc.claimCore.claimable(c.req.param('mint')) }));

  app.post(ROUTE_PATHS.claim_prepare, async (c) => {
    const body = ClaimPrepareBody.parse(await c.req.json());
    return c.json({ data: await svc.claimCore.prepare(body.mint, body.creatorWallet) });
  });

  app.post('/v1/fees/claim/submit', async (c) => {
    const body = ClaimSubmitBody.parse(await c.req.json());
    return c.json({ data: await svc.claimCore.submit(body.mint, { creatorWallet: body.creatorWallet, intentId: body.intentId, signedTransaction: body.signedTransaction }) });
  });

  app.get('/v1/ledger.json', async (c) =>
    c.json({ data: { summary: await svc.ledger.summary(), launches: await svc.ledger.recentLaunches(100), events: await svc.ledger.recentEvents(200) } }),
  );
  app.get('/ledger', async (c) => c.html(await renderLedgerPage(svc.ledger)));

  app.post('/mcp', async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json(MCP_PARSE_ERROR, 400);
    }
    const out = await dispatchMcp(body, svc);
    if (out === null) return c.body(null, 202);
    return c.json(out);
  });
  app.get('/mcp', (c) => c.json({ error: 'Use POST with a JSON-RPC body (initialize, tools/list, tools/call).' }, 405));

  app.onError((err, c) => {
    if (err instanceof z.ZodError) return c.json({ error: { code: 'invalid_request', message: err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') } }, 400);
    if (err instanceof LaunchError) return c.json({ error: { code: err.code, message: err.message } }, err.status as any);
    if (err instanceof StonkFunError) return c.json({ error: { code: `stonkfun_${err.code}`, message: err.message, charged: err.charged ?? null } }, err.status >= 500 ? 502 : (err.status as any));
    console.error('[v1] unhandled', err);
    return c.json({ error: { code: 'internal', message: 'internal error' } }, 500);
  });

  return app;
}
