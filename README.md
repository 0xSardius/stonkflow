# StonkFlow

Launch a coin that pays its holders in ANSEM, from one prompt, from any agent.

StonkFlow lets an AI agent launch a coin priced in a real asset (an xStock, a pre-IPO stock, a currency, or $ANSEM) on StonkFun, and pay the coin's holders in that asset on every trade. It ships as an x402-paid HTTP API, an MCP server, and a ClawPump community skill, plus one public flagship agent.

AnsemHack Clawrena entry. Register and tokenize on ClawPump by 2026-09-20 23:59 UTC.

## Docs

- `docs/PRD.md` — product requirements (v0.1)
- `docs/CHECKPOINT.md` — session checkpoint; read first
- `docs/prompts/solenrich-stonkfun-x402-prompt.md` — optional SolEnrich data endpoints (not on the critical path)

## Value proposition

- Agent builders: one skill turns "launch a memecoin" into "launch a coin against any asset"; you keep the creator fee.
- Holders: a coin that pays you in NVDAX or ANSEM instead of promising something.
- $ANSEM: a pricing asset and a dividend currency.
- pump.fun and ClawPump: SOL launches still go to pump.fun; StonkFlow adds the pairs they do not have.

## Run

```
bun install
cp .env.example .env
bun run dev          # http://localhost:3000  (routes free until PAYMENTS_ENABLED=true)
bun test
```

Surfaces: `GET /` (route index), `GET /v1/pairs`, `POST /v1/launch/self|managed`, `POST /v1/launch/submit`, `GET /v1/launch/:id`, `POST /mcp`, `GET /ledger`.

## Secrets

Copy `.env.example` to `.env`. `.env` and key files are gitignored. Never print secrets in the shell.
