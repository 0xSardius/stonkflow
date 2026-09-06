---
name: stonkflow
description: Launch coins paired with real assets (xStocks, pre-IPO stocks, currencies, $ANSEM) that pay holders in that asset. Pay per launch with x402.
---

# StonkFlow

StonkFlow lets you launch a coin priced in a real asset instead of SOL, on StonkFun (Solana). Reward-mode coins carry a 1% or 3% transfer tax that is paid to every holder in the quote asset on each trade. You pay per launch in USDC over x402 from your own wallet. No API key, no signup.

Base URL: https://stonkflow.xyz

## Routing rule

- Coin paired with SOL: use ClawPump's own launch tools (`launch_token_gasless`). Do not use StonkFlow.
- Coin paired with a stock, a pre-IPO stock, a currency, or $ANSEM: use StonkFlow.

## Steps (hosted ClawPump agent)

1. Read the quote assets: `GET https://stonkflow.xyz/v1/pairs` (free). Pick a `mint` with `agentLaunchable: true`. For ANSEM use exactly `9cRCn9rGT8V2imeM2BaKs13yhMEais3ruM3rPvTGpump`.
2. Check the price: `x402_pay_check` with url `https://stonkflow.xyz/v1/launch/managed`.
3. Quote the price to the user and get a yes.
4. Launch: `x402_pay` with method POST, that url, `confirm_payment: true`, `max_amount_usd` = the approved cap, and this JSON body:
   `{ "agentWallet": "<your wallet>", "quoteMint": "<mint>", "name": "<1-32 chars>", "symbol": "<1-10 chars>", "logo": "data:image/png;base64,...", "mode": "reward", "rewardTaxBps": "100", "idempotencyKey": "<unique string>" }`
   StonkFlow signs as creator (you cannot sign external transactions) and forwards any creator share to `agentWallet`.
5. Poll `GET https://stonkflow.xyz/v1/launch/<launchId>` until `status` is `completed`. It returns the mint and pool.
6. To hold a position, swap into the new mint from your own wallet with `swap_quote` then `swap_execute` (Raydium).
7. Report the launchId, mint, and the ledger link `https://stonkflow.xyz/ledger` to the user.

## Rules

- Never launch without the user's explicit yes on the price and the coin details.
- Never reuse an `idempotencyKey`. The same key returns the same launch.
- Never pay twice for one launch. A `processing` status means it is landing; poll, do not relaunch.
- `mode: "standard"` pays the creator 0.5% of volume instead of taxing transfers. Prefer `reward` unless the user asks for creator fees.
- Do not name a coin after ANSEM, ClawPump, StonkFun, or pump.fun. StonkFlow rejects those names.

## Self-hosted agents (Hermes / claw-agent, ElizaOS)

Attach the MCP at `https://stonkflow.xyz/mcp` and use `stonkflow_launch` with `signingMode: "self"`. You receive an unsigned transaction to sign with your own key, then call `stonkflow_submit`. You are creator-of-record and receive fees directly.
