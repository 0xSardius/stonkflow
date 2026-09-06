# Prompt for the solenrich repo (paste into Claude Code there)

Add a "StonkFun" product line to SolEnrich: x402-paid endpoints and MCP tools that understand quote-paired coins and reward-mode (transfer-tax) coins launched on stonkfun.xyz. This is a dependency for a separate hackathon product (working name Pair Router) that launches coins through StonkFun from ClawPump agents, so the risk and preflight endpoints must be callable machine-to-machine with no API key.

## Context you need

- StonkFun public API base: https://www.stonkfun.xyz/api/public/v1 . OpenAPI spec: https://www.stonkfun.xyz/api/public/v1/openapi.json . No API key. Rate limit 300 calls/min per IP for reads (429 with Retry-After; CDN cache hits do not count). Errors come back as { error: { code, message } }.
- Every StonkFun coin is priced against a quote asset (xStocks such as NVDAX/SPYX/TSLAX, Backpack pre-stocks, ANSEM, USDC/EURC/USDT, xSOL, custom mints). GET /pairs lists 349 pairs with category and launchLabReady.
- Two launch modes. standard: creator earns 0.5% of every trade (1.5% on the 2% fee tier), claimable via /tokens/{mint}/fees. reward: a Token-2022 transfer tax (100 or 300 bps) is paid to all holders in the quote token; no creator fee. About 69% of the 8,166 launches are reward mode.
- Self-built LaunchLab launches are "adopted" by StonkFun only if every curve parameter matches GET /launchlab/pricing?quoteMint=... exactly (GlobalConfig, cpmm curve, supply, totalSellA, 6-decimal Token-2022 base mint, platform ID per mode, curve-rule account appended last, and for reward mode the exact transfer-fee field names transferFeeBasePoints and maxinumFee). A mismatch or typo silently produces a launch that forwards fees to nobody or taxes nobody.
- Useful reads: GET /tokens (q, sort, mode, status, quoteMint, category, page, pageSize), GET /tokens/{mint}, /tokens/{mint}/rewards, /tokens/{mint}/fees, /tokens/{mint}/airdrop, /tokens/{mint}/backing, /tokens/{mint}/burns, GET /launches?creator=, GET /rewards, GET /revenue, GET /revenue/history, GET /stats.
- Reuse SolEnrich's existing x402 middleware, pricing table, MCP tool registration, LLM-briefing formatter, and Helius RPC client. Follow the repo's existing endpoint conventions (naming, response envelope, tests, docs page, agent-card entry).

## Endpoints to add (all x402, USDC on Solana/Base, plus the existing Stripe/MPP path)

1. GET /v1/stonk/token/{mint}/reward-risk  ($0.005)
   Returns a 0-100 score and reasons for a reward-mode coin: launchpad/adoption status, transfer-fee bps and maxinumFee read from the Token-2022 mint extension on-chain (not only from StonkFun), whether the tax is zero-rate or unadopted, rewards distributed to date and last distribution time from /tokens/{mint}/rewards, flywheel.active, holder count, top-10 holder concentration, quote asset and its category, age, graduation status. Include an llm_brief string.

2. GET /v1/stonk/token/{mint}/yield  ($0.005)
   Trailing 7d and 30d holder yield: rewards distributed in the quote asset converted to USD (Jupiter price API) divided by average market cap over the window, annualized only with an explicit caution flag when the window is under 7 days. Also return quote-exposure: what the holder is economically long (meme + quote asset), and the reward asset symbol.

3. GET /v1/stonk/screener  ($0.01)
   Ranked list across all reward coins with filters: quoteMint, category (xstock, prestock, currency, leverage, custom), minHolders, minAgeDays, sort by yield7d | yield30d | rewardsUsd | volume24h. Backed by a scheduled ingest (every 10 minutes) of /tokens and /rewards into the existing datastore.

4. POST /v1/stonk/launch/preflight  ($0.25)
   Body: { unsignedTransaction (base64), quoteMint, mode }. Decode the LaunchLab initialize instruction, diff every parameter against GET /launchlab/pricing for that quoteMint and mode, and return { ok, mismatches: [{ field, expected, actual, fix }], warnings }. Must catch: wrong decimals, wrong supply or totalSellA, missing curve-rule account, wrong platform ID for the mode, wrong or misspelled transfer-fee fields, zero-rate transfer fee, wrong token program for the quote.

5. GET /v1/stonk/pairs  (free)
   Cached pass-through of /pairs with our category normalization and an isAgentLaunchable flag (launchLabReady and category in the allowed set).

## MCP tools

Register five tools mirroring the endpoints: stonk_reward_risk, stonk_yield, stonk_screener, stonk_preflight, stonk_pairs. Descriptions must tell an agent when to call them (before buying a reward coin; before broadcasting a self-built launch; when asked "which coins pay holders in NVDAX").

## Acceptance

- Each endpoint has a unit test with recorded fixtures and one live smoke test behind an env flag.
- Zero-rate or unadopted reward coins get a score under 20 and a clear reason string.
- Preflight rejects a transaction with maxinumFee misspelled and a transaction missing the curve-rule account.
- Screener responds under 300 ms from cache.
- Docs page, agent-card entry, pricing table, and x402 bazaar metadata updated.
- Do not print or commit any secrets. Keep the existing rate limits and facilitator config.

Ship in small commits: pairs and ingest first, then reward-risk, yield, screener, preflight, then MCP and docs.
