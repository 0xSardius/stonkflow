# StonkFlow task list

Updated 2026-09-06. Deadline: token live and verified on ClawPump by 2026-09-20 23:59 UTC. Judging Sep 21-30. Winners Oct 1.

Owner: **you** = needs your account, wallet, or a spend decision. **Claude** = code and docs.

## Done

- [x] Idea shortlist and StonkFlow plan (research folder, local only)
- [x] PRD v0.2, CLAUDE.md, checkpoint, repo on GitHub with gitignore
- [x] Day-1 checks: ClawPump cannot sign external tx (managed mode added); x402_pay works; MCP attaches on self-hosted claw-agent; payout wallet tool exists; ANSEM pair launchable (official mint pinned); UsePod feasible
- [x] Scaffold: router core, self/managed signing, x402 mount, MCP, sqlite ledger + page, holder gate, ClawPump skill text, 22 tests, live smoke
- [x] StonkFun prepare verified live (free). Launch fee corrected to 0.29 SOL. Managed price $35.
- [x] You: ClawPump account, StonkFlow agent, API key in .env, x402 skill on, wallet funded, x402_pay test against SolEnrich

## This week (Sep 7-10)

- [ ] **you** Send me the agent wallet address and the x402 test tx signature (for the checkpoint and pitch)
- [ ] **you** Buy stonkflow.xyz (and .fun if cheap); email alias; claim the X handle
- [ ] **you** Sep 8: register the team on clawpump.tech/ansemhack with that handle; tick ClawPump x pump.fun and Inference Markets; post the announcement; follow @clawpumptech
- [ ] **you** Sep 8: set the payout wallet on the agent; book a livestream slot for the week of Sep 15
- [ ] **you** Decide: holder discount threshold (default 10,000 tokens) and buyback share of router income
- [ ] **you** Rename .env keys to TREASURY_SECRET_KEY and LEDGER_DB_PATH; create a fresh treasury keypair; fund it with about 0.5 SOL
- [ ] **you** Approve the first live StonkFun launch from your wallet (0.29 SOL). Doubles as flagship coin #1: ANSEM pair, reward mode, 1% tax.
- [ ] Claude: deploy to Railway with PAYMENTS_ENABLED=true, X402_PAY_TO_ADDRESS, PUBLIC_URL=https://stonkflow.xyz; confirm a 402 challenge from the public URL
- [ ] Claude: first live launch through the router (self mode) once approved; fix any submit/status field names
- [ ] **you** Sep 9-10: launch the entry token through the ClawPump agent (gasless) the same day; verify it against the X handle; send me the mint
- [ ] Claude: set ENTRY_TOKEN_MINT; turn on holder pricing; post the launch + ledger link thread draft

## Next week (Sep 11-16)

- [ ] Claude: ClawPump community skill PR (skills/stonkflow) to ClawPump/agents-skills
- [ ] Claude: claw-agent optional-mcps manifest for the StonkFlow MCP (self-hosted Hermes)
- [ ] Claude: list on Pay.sh and Dexter for discovery (x402 bazaar listing follows from CDP settlement if CDP keys are used)
- [ ] Claude: flagship agent custom skill on ClawPump (create_custom_skill) that runs the weekly launch via x402_pay
- [ ] Claude: UsePod inference for the flagship agent with per-request receipts on the ledger (Inference Markets track)
- [ ] Claude: buyback job wired to Jupiter swap; forward job for managed-launch creator share
- [ ] **you** Sep 15-16 livestream: live ANSEM-paired launch from one prompt; pitch deck (4 questions: team, product/demo, market/GTM/traction, token utility/roadmap)

## Onboarding and submission (Sep 17-20)

- [ ] **you** + Claude: DM 10 hackathon teams and 5 agent operators; offer a free first launch (we cover the $1; they pay the 0.29 SOL in self mode, or we run managed)
- [ ] Claude: fix what breaks in their runs; target 3 external agents routing a launch
- [ ] **you** Sep 20: confirm registration + token on the entry form; attach token link

## Judging (Sep 21-30)

- [ ] **you** Weekly flagship launch (about 0.29 SOL each); second livestream slot
- [ ] Claude: weekly numbers post from the ledger; keep the service up; no scope changes

## Later (after Oct 1)

- [ ] Self-built LaunchLab path at 0.03 SOL (codec in ../solenrich) to cut the launch fee 10x
- [ ] Entry token as a StonkFun quote pair after graduation
- [ ] FeeSweep connector for StonkFun claims

## Open questions

1. Final handle/domain confirmed as StonkFlow?
2. Holder threshold and buyback share (numbers).
3. Treasury cap for managed launches (0.29 SOL each; 2 SOL cap = about 6 launches).
4. CDP facilitator keys (bazaar auto-listing) or PayAI (no keys)? SolEnrich uses CDP.
