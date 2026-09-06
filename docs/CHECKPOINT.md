# Checkpoint

Updated: 2026-09-06

## Project
StonkFlow: agent launches of asset-paired coins on StonkFun via x402 + MCP + ClawPump skill. AnsemHack Clawrena entry.

## State
- Docs-only repo created 2026-09-06. No code yet.
- Idea phase (solana.new find-next-crypto-idea): scored 13/15. validate-idea sprint not run; folded into Day-1 checks and Sep 17-19 onboarding.
- PRD v0.1 in docs/PRD.md. Build plan is in the local research folder (not tracked).

## Decisions
- Name: StonkFlow (X handle and domain still to check).
- Entry token on ClawPump (gasless pump.fun curve), launched Sep 9-10 with the first routed launch. Two rules: holders pay less on POST /launch; a fixed share of router income buys the token and ANSEM. Roadmap: token as StonkFun quote pair after graduation.
- Team tokens do not move before Oct 1. No revenue share to holders. No return promises.
- Flagship coins: ANSEM-paired in reward mode for the stream; xStock-paired in standard mode (2% tier) for revenue.
- SolEnrich is a dependency only (risk check, x402 server code). Do not ship SolEnrich work as part of the entry.

## Deadlines
- Sep 8: register, post on X, follow @clawpumptech, create agent, set payout wallet, book livestream slot.
- Sep 20 23:59 UTC: token live and verified against project X handle.
- Sep 21-30 judging. Oct 1 winners.

## Day 0-1 checks (2026-09-06)
Results in PRD section 9. Summary: hosted ClawPump agents cannot sign external transactions (-> managed signing mode) but can pay any x402 URL (x402_pay). Self-hosted claw-agent (Hermes fork) attaches MCPs. ANSEM pair is launchable; official mint 9cRCn9rGT8V2imeM2BaKs13yhMEais3ruM3rPvTGpump (a copycat ANSEM mint is also listed). UsePod is feasible; stack the Inference Markets track. Domain: stonkflow.xyz primary, .fun as redirect.

## Next
1. Founder-only checks: create ClawPump agent, enable x402 skill, live x402_pay against a SolEnrich endpoint, set payout wallet.
2. /scaffold-project (Next.js + @solana/kit + x402 server from solenrich + MCP).
3. Router core, then token launch with first routed launch.

## Open questions
1. Final X handle / domain for StonkFlow.
2. Holder threshold for the discount; buyback share of router income.
3. Exact pump.fun creator-fee rate through ClawPump.
4. Stack the Inference Markets track (UsePod)?
