# StonkFlow PRD

Status: draft v0.2, 2026-09-06 (Day-1 checks recorded). Owner: 0xSardius. Target: AnsemHack Clawrena entry, tokenized by 2026-09-20 23:59 UTC.

## 1. Summary

StonkFlow lets any AI agent launch a coin priced in a real asset (an xStock, a pre-IPO stock, a currency, or $ANSEM) and pay the coin's holders in that asset on every trade. It ships as an x402-paid HTTP service, an MCP server, and a ClawPump community skill, plus one public flagship agent that uses it. SolEnrich is a data dependency, not part of the product.

One sentence: "Launch a coin that pays its holders in ANSEM, from one prompt, from any agent."

## 2. Problem

Every agent launchpad, ClawPump included, launches coins against SOL on pump.fun. An agent cannot express a view on a stock, an IPO, or a community token, and no agent-launched coin can pay its holders in anything real. StonkFun already supports 349 quote pairs and holder rewards through a Token-2022 transfer tax, but it has no agent runtime, no MCP, no skill, no webhooks, and no way for an agent that holds USDC but not SOL to pay the deploy fee.

## 3. Goals

1. An agent launches a coin paired with any StonkFun-launchable asset with one paid call.
2. Two signing tiers. Self-hosted agents (Hermes/claw-agent, ElizaOS) sign their own launch and are creator-of-record. Hosted ClawPump agents cannot sign arbitrary transactions, so StonkFlow signs as creator-of-record and forwards the creator share to the agent's wallet by rule, on the ledger.
3. Billing is per call in USDC over x402. No accounts, no API keys.
4. Every launch, fee, buyback, and holder payout is on a public ledger page.
5. Judges see a net-new $ANSEM use case live on stream.

## 4. Non-goals (before 2026-09-20)

- Self-built LaunchLab transactions or launch preflight. StonkFlow uses StonkFun's two-call API.
- Trading, market making, or exit logic for launched coins.
- Webhooks, screeners, or yield analytics (SolEnrich roadmap).
- Revenue share, staking, or governance for the entry token.
- The entry token as a StonkFun quote pair (post-graduation milestone).

## 5. Users

| User | Job | Success |
|------|-----|---------|
| Agent builder on ClawPump | Give my agent asset-paired launches | Toggles the skill, launches in one call, keeps the creator fee |
| Agent operator (ElizaOS, OpenClaw) | Same, outside ClawPump | Adds the MCP, pays per call |
| Flagship agent (ours) | Launch one event-driven coin per week | Public track record, fee income, ANSEM paid to holders |
| Coin holder | Get paid in the real asset | Sees payouts on the ledger and in the wallet |
| Judge | Score novelty, volume, attention, ANSEM use, early deploy | Ledger and livestream show all five |

## 6. User stories

1. As an agent, I call `POST /v1/launch` with name, symbol, logo, quoteMint, mode, optional dev buy, and receive an unsigned transaction and a quote. I sign and call `POST /v1/launch/submit`. I poll `GET /v1/launch/{id}` until `completed`.
2. As an agent with USDC but no SOL, I pay a higher x402 price and StonkFlow sends the deploy fee and dev-buy SOL to my wallet before I sign.
3. As an agent, I call `GET /v1/pairs` for free and receive the launchable pairs with categories and an `agentLaunchable` flag.
4. As an agent, I call `POST /v1/fees/claim` for a coin I created and receive an unsigned claim transaction.
5. As a token holder, I sign a message with my wallet, and `POST /v1/launch` quotes me the holder price.
6. As anyone, I open the ledger page and see every launch attributed to its paying wallet, fees earned, buybacks executed, and ANSEM paid to holders.

## 7. Functional requirements

### 7.1 Router API

Signing model (decided 2026-09-06 after the Day-1 checks):

- StonkFun requires `creatorWallet` to sign the launch payment, and creator fees land in `creatorWallet`'s token accounts (forwarded automatically on LaunchLab launches).
- Hosted ClawPump agents have no tool to sign an externally prepared transaction. They can pay any x402 URL from their wallet with `x402_pay` (hard-capped, needs the `x402` skill), swap on Raydium with `swap_execute`, and transfer with `wallet_transfer`.
- Therefore `POST /launch` takes `signingMode`: `self` (returns the unsigned transaction for the agent to sign; agent is creator-of-record) or `managed` (StonkFlow's treasury key signs as creator; the agent supplies `payoutWallet`; StonkFlow forwards the creator share to `payoutWallet` on every claim/forward and posts it to the ledger). Reward-mode launches have no creator fee, so `managed` has no fee custody at all.
- The agent's own position comes from its own swap after the pool exists. StonkFlow does not custody agent tokens.


- Base `/v1`. JSON. Idempotency key on every write. Errors as `{ error: { code, message } }`.
- `POST /launch` (x402; `self` $1.00 plus the agent pays StonkFun's 0.2904 SOL launch fee itself when it signs; `managed` $1.00 + 0.2904 SOL at spot + 10%, about $35 at $106/SOL; holder price discounts the USD part): validates input against `GET /pairs`, calls StonkFun `POST /launches/prepare`. `self` returns `{ launchId, unsignedTransaction, quote, expiresAt }`. `managed` signs, submits, and returns `{ launchId, status }` directly.
- `POST /launch/submit` (free): forwards the signed transaction to StonkFun `POST /launches/submit`, stores the payment signature, returns `{ launchId, status }`.
- `GET /launch/{launchId}` (free): polls StonkFun `GET /launches/{paymentSignature}`, returns status, mint, pool address.
- `POST /fees/claim` (x402, $0.10): wraps StonkFun claim prepare; `POST /fees/claim/submit` (free) wraps claim submit.
- `GET /pairs` (free, cached 60 s): StonkFun pairs with category normalization and `agentLaunchable = launchLabReady && category in {xstock, prestock, currency, leverage, ansem, custom-allowlist}`.
- Retry rules: on StonkFun 409 do not re-pay, re-run prepare; on 503 with `charged:false` retry; on 429 honor `Retry-After`.
- Name and symbol screening list; per-payer-wallet limit of 5 launches per hour.

### 7.2 Billing

- x402 middleware reused from solenrich. USDC on Solana; Base accepted. Facilitator: PayAI or CDP.
- Holder price: agent sends `X-Wallet` and `X-Wallet-Signature` over a server nonce; server checks entry-token balance above a threshold, returns the lower price in the 402 response.
- SOL fronting is folded into `managed` mode: the treasury pays the 0.2904 SOL launch fee (verified live 2026-09-06; the 0.03 SOL figure applies only to self-built LaunchLab transactions) and the agent repays it inside the x402 price. No SOL is sent to agent wallets.

### 7.3 MCP server and skill

- MCP over HTTP with tools `stonkflow_pairs`, `stonkflow_launch`, `stonkflow_submit`, `stonkflow_status`, `stonkflow_claim`. Tool descriptions tell the agent when to use asset pairs instead of pump.fun and how to sign.
- Community skill PR to ClawPump/agents-skills: `skills/stonkflow/SKILL.md` and `metadata.json`, plus a `registry.json` entry. The skill instructs: route SOL pairs to pump.fun via ClawPump tools; route asset pairs to StonkFlow; pay via x402; sign with the agent wallet; never share keys.

### 7.4 Flagship agent

- Runs on ClawPump with its own wallet. Inference on UsePod if the Day-1 check passes, otherwise Claude.
- Policy: one launch per week tied to an earnings, IPO, or ANSEM event; reward mode; 1% tax; quote = ANSEM or the relevant xStock; small fixed dev buy; SolEnrich due-diligence call before any dev buy.
- Publishes every action to the ledger and an X thread.

### 7.5 Ledger page

- Public Next.js page: launches routed (by wallet), agents served, volume, creator fees earned, ANSEM paid to holders, buybacks of the entry token and ANSEM, SOL fronted and repaid.
- Data from StonkFun reads plus StonkFlow's own database. Refresh every 5 minutes.

### 7.6 Entry token rules

- Launched through ClawPump (gasless pump.fun curve) linked to the flagship agent; payout wallet set before launch; verified against the project X handle.
- Rule 1: holders pay the holder price on `POST /launch`.
- Rule 2: a fixed share of router income (x402 fees plus flagship creator fees) buys the entry token and ANSEM 50/50 on a daily schedule; every buy is posted to the ledger.
- Roadmap: after graduation, list the token as a StonkFun quote pair.

## 8. Non-functional requirements

- Non-custodial: no private keys stored; only StonkFlow's own treasury key for SOL fronting and buybacks, in a hot wallet with a capped balance.
- Idempotent writes; at-most-once payment per launch.
- p95 latency under 2 s for `POST /launch` excluding StonkFun time.
- Rate limits respected: 25/min on StonkFun prepare, so StonkFlow queues above 20/min.
- Secrets in environment only; `.env` gitignored before first commit; no secrets printed in logs.

## 9. Dependencies and Day-1 checks (results 2026-09-06)

| Check | Result | Consequence |
|-------|--------|-------------|
| ClawPump agent can sign an unsigned transaction from an external tool | FAIL (docs and the claw-agent skill list no such tool; domain tools sign internally) | `managed` signing mode for hosted agents; `self` mode for self-hosted Hermes/Eliza agents |
| Agent can call an external x402 endpoint | PASS (`x402_pay_check` + `x402_pay` pay any URL from the agent wallet, hard-capped, needs the `x402` skill enabled via `update_agent`) | No Pay.sh listing required; list on Pay.sh and Dexter anyway for discovery |
| External MCP can be attached | PASS for self-hosted claw-agent (`hermes mcp install`, `optional-mcps/` manifests); NOT for hosted agents (prompt-only custom skills) | Ship the MCP for self-hosted agents; ship a `create_custom_skill` prompt that teaches hosted agents to use `x402_pay` against StonkFlow |
| Payout wallet | PASS (`set_external_wallet`; dashboard) | Set before token launch |
| ANSEM pair launchable on StonkFun | PASS, with a trap: two "The Black Bull" ANSEM mints are listed. Official is `9cRCn9rGT8V2imeM2BaKs13yhMEais3ruM3rPvTGpump` (pump.fun origin, Token-2022). Pin the mint; never resolve by symbol | Hardcode the mint in the pair catalog |
| UsePod feasible | PASS (`https://api.usepod.ai/v1`, OpenAI/Anthropic-compatible, x402 per request on Solana; ClawPump has `usepod_provision`) | Stack the Inference Markets track; flagship agent inference on UsePod with receipts on the ledger |

Still needs the founder's account (cannot be done by Claude): create the ClawPump agent, enable the `x402` skill, run one live `x402_pay` against a SolEnrich endpoint to confirm Solana USDC settlement, set the payout wallet.

## 10. Success metrics (by 2026-09-30)

| Metric | Target |
|--------|--------|
| External agents that routed a launch | 3 or more |
| Launches routed (total) | 10 or more |
| Paid x402 calls from wallets we do not control | 50 or more |
| ANSEM paid to holders via flagship coins | any nonzero, shown on stream |
| Livestream slots completed | 2 |
| Days of on-chain history at judging start | 11 or more (token live by Sep 10) |

Kill line: fewer than 3 external launches by Sep 20 means the entry stands on the flagship agent alone.

## 11. Risks

- Judges score "what you added, not what you wrapped." Pitch leads with asset pairs, holder payouts, and the ANSEM loop, not the integration.
- pump.fun on the panel. SOL pairs still route to pump.fun; StonkFlow adds pairs.
- Launched coins rug. Every launch is attributed to the paying wallet on the ledger; rate limits; screening.
- Curve goes quiet. Weekly flagship launches and the ledger link in the token description.
- Securities optics. No revenue share, no return promises, utility stated as two rules.

## 12. Timeline

Sep 6-7 checks. Sep 8 register, agent, payout wallet, livestream slot. Sep 8-9 router core. Sep 9-10 token live with first routed launch. Sep 10-11 billing and holder price. Sep 12 MCP, skill PR, bazaar. Sep 13-14 flagship agent. Sep 15-16 ledger, pitch, live ANSEM launch on stream. Sep 17-19 onboard external agents. Sep 20 submit. Sep 21-30 weekly launches, second stream.

## 13. Open questions

1. Final name and X handle (StonkFlow assumed).
2. Entry-token holder threshold for the discount.
3. Share of router income allocated to buybacks.
4. Treasury hot-wallet cap for managed launches (0.29 SOL each plus buybacks; a 2 SOL cap is about 6 launches).
5. Whether StonkFun will list a graduated pump.fun token as a custom quote pair.
