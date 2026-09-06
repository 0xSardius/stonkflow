# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

StonkFlow lets an AI agent launch a coin priced in a real asset (xStock, pre-stock, currency, or $ANSEM) on StonkFun and pay holders in that asset. It is an AnsemHack Clawrena entry. The token must be live on ClawPump by 2026-09-20 23:59 UTC. Judging is Sep 21-30.

Read in this order at session start: `docs/CHECKPOINT.md`, then `docs/PRD.md`. The PRD is the spec; sections 7 (functional requirements) and 9 (Day-1 checks) drive the build. The checkpoint holds decisions already made. Do not reopen them without the user.

## Commands

```
bun install            # deps (Bun 1.2+)
bun run dev            # watch mode on :3000, all routes free unless PAYMENTS_ENABLED=true
bun test               # 22 unit/integration tests, in-memory sqlite, fake StonkFun
bun test test/launch.test.ts -t "409"   # one test by name
bun run type-check     # tsc --noEmit
bun run smoke          # live read-only check against StonkFun (pairs + ANSEM pricing)
```

Tests never hit the network: `StonkFunClient` takes a `fetchImpl`, and `buildServices` takes `stonkfun`, `ledger`, `treasury` overrides.

## Stack (mirrors solenrich)

The sibling repo `../solenrich` is the reference implementation for payments, MCP, and agent identity. Copy patterns from it instead of inventing new ones:

- Runtime: Bun + Hono. Scripts there are `bun run --watch src/index.ts` (dev), `bun build src/index.ts --outdir=dist --target=bun`, `tsc --noEmit`.
- x402: `@x402/hono` middleware with `@x402/svm` (Solana) and `@x402/evm` (Base). See `../solenrich/src/config.ts` for the pricing table pattern and `src/index.ts` for middleware wiring.
- MCP: `@modelcontextprotocol/sdk` over HTTP. See `../solenrich/src/lib/mcp-http.ts` and `src/mcp-tools.ts`.
- Agent identity and caller attribution: `@lucid-agents/*` and `../solenrich/src/lib/caller-id.ts`.
- Solana: `@solana/kit` for new code; `@solana/web3.js` only where a dependency requires it. `helius-sdk` for RPC.
- Validation: `zod` schemas per endpoint, in `src/schemas/`.
- Cache: Upstash Redis.

## Architecture (from the PRD)

One deployable Bun/Hono service with four surfaces that share one core:

1. **Router core** (`src/core/launch.ts`, `claim.ts`, `pairs.ts`, `signer.ts`) over `src/stonkfun/client.ts` (reads + prepare/submit/status/claim). `LaunchCore.launch` is the single entry for both signing modes; `submit` and `status` finish self-mode launches. StonkFun retry rules are part of the core, not the handlers: on 409 re-run prepare and never re-pay; on 503 with `charged:false` retry; on 429 honor `Retry-After`. StonkFun allows 25 prepare calls/min per IP, so the core queues above 20/min.
2. **HTTP API** (`src/routes/v1.ts`, `holder.ts`; x402 mounted in `src/app.ts`): paid routes are `POST /v1/launch/self`, `/v1/launch/managed`, their `/holder` variants, and `POST /v1/fees/claim`. Free: `/v1/pairs`, `/v1/launch/submit`, `/v1/launch/:id`, `/v1/fees/:mint`, `/v1/nonce`, `/ledger`, `/mcp`. Prices and paths live in `PRICING` / `ROUTE_PATHS` in `src/config.ts`. Holder pricing is a separate route gated by a nonce signature plus entry-token balance, because x402 prices are static per route.
3. **MCP server** (`src/mcp/tools.ts`, `http.ts`): stateless JSON-RPC dispatcher. Read tools call the core directly; paid write tools call the HTTP route so x402 is enforced on one path and the 402 challenge is surfaced as text. Tool descriptions tell the agent to route SOL pairs to pump.fun and asset pairs to StonkFlow.
4. **Ledger** (`src/ledger/store.ts` on bun:sqlite at `LEDGER_DB_PATH`, `page.ts` server-rendered): every launch, payment, buyback, forward, and claim is a row and is rendered on `/ledger`. If it is not on the ledger, it did not happen.

`src/jobs/`: the flagship calendar (data the ClawPump agent executes) and the buyback job (dry-run until the entry token exists). Two scheduled jobs: the flagship agent policy (one launch per week, reward mode, SolEnrich due-diligence call before any dev buy) and the buyback job (fixed share of router income buys the entry token and ANSEM 50/50, posted to the ledger).

## Invariants

- Two signing modes. `self`: the agent signs and is creator-of-record. `managed`: StonkFlow's treasury key signs as creator (hosted ClawPump agents cannot sign arbitrary transactions) and forwards the creator share to the agent's `payoutWallet` by rule. The treasury hot wallet has a capped balance. No other private keys, ever.
- Hosted ClawPump agents reach StonkFlow through `x402_pay` (pay any URL, needs the `x402` skill). Self-hosted claw-agent (Hermes) attaches the MCP with `hermes mcp install`.
- At-most-once payment per launch. Every write takes an idempotency key.
- Holder pricing: the agent proves its wallet with a signature over a server nonce; the server checks entry-token balance and returns the lower price in the 402 response.
- SOL pairs never route to StonkFun. That routing decision is deliberate for the hackathon and is stated in the skill text.
- Fees, taxes, and payouts are denominated in the quote asset (ANSEM, NVDAX, USDC). Do not display them as USD without a price source.

## External APIs

- StonkFun: no API key. Base `/api/public/v1`. Two-call launch flow. Reward mode = Token-2022 transfer tax paid to holders in the quote token. Standard mode = creator earns 0.5% of volume (1.5% on the 2% tier).
- ClawPump: hosted agents have their own wallet; domain tools sign internally; no generic sign tool. `x402_pay` pays any x402 URL. `swap_execute` covers Raydium. `wallet_transfer` needs a whitelisted destination. claw-agent is a Hermes (Nous Research) fork: the 'Hermes DeFi harness' in the track text is this runtime. Community skills are prompt-only (`SKILL.md` + `metadata.json` in `ClawPump/agents-skills`). Payout wallet is set via dashboard or the `set_external_wallet` MCP tool.
- x402 facilitator: PayAI or CDP on Solana.
- ANSEM official mint: `9cRCn9rGT8V2imeM2BaKs13yhMEais3ruM3rPvTGpump`. A second ANSEM mint exists on StonkFun; never resolve ANSEM by symbol.
- UsePod: `https://api.usepod.ai/v1`, OpenAI/Anthropic-compatible, x402 per request. Flagship inference runs here for the Inference Markets track.

## Docs conventions

- `docs/research/` and `data/` are gitignored on purpose. Do not add them back.
- `skills/stonkflow/` is the ClawPump community skill (prompt-only). It is copied into a PR on `ClawPump/agents-skills`; keep it in sync with the routes.
- Write-endpoint field names in `src/stonkfun/types.ts` (`paymentTransaction`, `signedQuote`, `intentId`, `transaction`) are from the endpoint descriptions, not the schema. Verify on the first live launch and fix the types if they differ.
- `docs/prompts/solenrich-stonkfun-x402-prompt.md` is for the solenrich repo, not this one. It is not on the critical path.
- Update `docs/CHECKPOINT.md` at every session end. Commit messages carry no Co-Authored-By line.
- Write in plain, active, present-tense sentences. Same word for the same thing throughout.
