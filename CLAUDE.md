# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

StonkFlow lets an AI agent launch a coin priced in a real asset (xStock, pre-stock, currency, or $ANSEM) on StonkFun and pay holders in that asset. It is an AnsemHack Clawrena entry. The token must be live on ClawPump by 2026-09-20 23:59 UTC. Judging is Sep 21-30.

Read in this order at session start: `docs/CHECKPOINT.md`, then `docs/PRD.md`. The PRD is the spec; sections 7 (functional requirements) and 9 (Day-1 checks) drive the build. The checkpoint holds decisions already made. Do not reopen them without the user.

The repo is docs-only until `/scaffold-project` runs. There are no build, lint, or test commands yet. Add them to this file when the scaffold lands.

## Intended stack (mirror solenrich)

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

1. **Router core** (`src/core/`): typed StonkFun client generated from `https://www.stonkfun.xyz/api/public/v1/openapi.json`, plus three idempotent orchestrations: `launch` (prepare -> return unsigned tx), `submit` (forward signed tx), `claim`. StonkFun retry rules are part of the core, not the handlers: on 409 re-run prepare and never re-pay; on 503 with `charged:false` retry; on 429 honor `Retry-After`. StonkFun allows 25 prepare calls/min per IP, so the core queues above 20/min.
2. **HTTP API** (`src/routes/`): `/v1/launch` and `/v1/fees/claim` sit behind x402. `/v1/launch/submit`, `/v1/launch/{id}`, `/v1/pairs` are free. Prices live in one config table.
3. **MCP server** (`src/mcp/`): five tools that call the same core functions as the routes. Tool descriptions tell the agent to route SOL pairs to pump.fun and asset pairs to StonkFlow.
4. **Ledger** (`src/ledger/`): every launch, payment, SOL fronting transfer, buyback, and holder payout is written to the database and rendered on a public page. If it is not on the ledger, it did not happen.

Two scheduled jobs: the flagship agent policy (one launch per week, reward mode, SolEnrich due-diligence call before any dev buy) and the buyback job (fixed share of router income buys the entry token and ANSEM 50/50, posted to the ledger).

## Invariants

- Non-custodial. The agent signs its own launch. StonkFlow holds one treasury hot wallet for SOL fronting and buybacks, with a capped balance. No other private keys, ever.
- At-most-once payment per launch. Every write takes an idempotency key.
- Holder pricing: the agent proves its wallet with a signature over a server nonce; the server checks entry-token balance and returns the lower price in the 402 response.
- SOL pairs never route to StonkFun. That routing decision is deliberate for the hackathon and is stated in the skill text.
- Fees, taxes, and payouts are denominated in the quote asset (ANSEM, NVDAX, USDC). Do not display them as USD without a price source.

## External APIs

- StonkFun: no API key. Base `/api/public/v1`. Two-call launch flow. Reward mode = Token-2022 transfer tax paid to holders in the quote token. Standard mode = creator earns 0.5% of volume (1.5% on the 2% tier).
- ClawPump: agents have their own wallet and sign their own transactions. Community skills are prompt-only (`SKILL.md` + `metadata.json` in `ClawPump/agents-skills`). Payout wallet is set via dashboard or the `set_external_wallet` MCP tool.
- x402 facilitator: PayAI or CDP on Solana.

## Docs conventions

- `docs/research/` is gitignored on purpose. Do not add it back.
- `docs/prompts/solenrich-stonkfun-x402-prompt.md` is for the solenrich repo, not this one. It is not on the critical path.
- Update `docs/CHECKPOINT.md` at every session end. Commit messages carry no Co-Authored-By line.
- Write in plain, active, present-tense sentences. Same word for the same thing throughout.
