# Checkpoint

Updated: 2026-09-06

## Project
StonkFlow: agent launches of asset-paired coins on StonkFun via x402 + MCP + ClawPump skill. AnsemHack Clawrena entry.

## State
- Docs-only repo created 2026-09-06. No code yet.
- Idea phase (solana.new find-next-crypto-idea): scored 13/15. validate-idea sprint not run; folded into Day-1 checks and Sep 17-19 onboarding.
- PRD v0.1 in docs/PRD.md. Build plan in docs/research/idea-deep-dive-20260906-pair-router.html.

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

## Next
1. Day 0-1 checks (see PRD section 9): ClawPump agent can sign external unsigned tx; skill can call x402 or MCP attach; payout wallet; ANSEM pair launchLabReady; UsePod inference feasibility.
2. /scaffold-project (Next.js + @solana/kit + x402 server from solenrich + MCP).
3. Router core, then token launch with first routed launch.

## Open questions
1. Final X handle / domain for StonkFlow.
2. Holder threshold for the discount; buyback share of router income.
3. Exact pump.fun creator-fee rate through ClawPump.
4. Stack the Inference Markets track (UsePod)?
