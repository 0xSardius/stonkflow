# Same base as ../solenrich (pinned for reproducible builds).
FROM oven/bun:1.3.14 AS base
WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

COPY src ./src
COPY scripts ./scripts
COPY skills ./skills

# The sqlite ledger lives on a Railway volume mounted at /data (see railway.json notes).
RUN mkdir -p /data
ENV LEDGER_DB_PATH=/data/ledger.sqlite

EXPOSE 3000
CMD ["bun", "run", "src/index.ts"]
