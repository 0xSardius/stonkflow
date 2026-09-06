import type { Ledger } from './store';
import { SERVICE } from '../config';

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const short = (s: string | null) => (s ? `${s.slice(0, 4)}…${s.slice(-4)}` : '—');

/** Server-rendered public ledger. No client JS, no external assets. */
export async function renderLedgerPage(ledger: Ledger): Promise<string> {
  const [summary, launches, events] = await Promise.all([ledger.summary(), ledger.recentLaunches(50), ledger.recentEvents(60)]);
  const quoteRows = Object.entries(summary.byQuote)
    .sort((a, b) => b[1] - a[1])
    .map(([q, n]) => `<tr><td>${esc(q)}</td><td>${n}</td></tr>`)
    .join('');
  const launchRows = launches
    .map(
      (l) => `<tr>
        <td title="${esc(l.createdAt)}">${esc(l.createdAt.slice(0, 16).replace('T', ' '))}</td>
        <td>${esc(l.symbol)}<br><small>${esc(l.name)}</small></td>
        <td>${esc(l.quoteSymbol)}<br><small>${esc(l.quoteCategory)}</small></td>
        <td>${esc(l.mode)}${l.transferFeeBps ? ` <small>${l.transferFeeBps / 100}% tax</small>` : ''}</td>
        <td>${esc(l.signingMode)}</td>
        <td><code title="${esc(l.agentWallet)}">${short(l.agentWallet)}</code></td>
        <td class="s-${esc(l.status)}">${esc(l.status)}</td>
        <td>${l.mint ? `<a href="https://www.stonkfun.xyz/token/${esc(l.mint)}" rel="noopener"><code>${short(l.mint)}</code></a>` : '—'}</td>
      </tr>`,
    )
    .join('');
  const eventRows = events
    .map((e) => `<tr><td>${esc(e.ts.slice(0, 19).replace('T', ' '))}</td><td>${esc(e.kind)}</td><td><code>${short(e.launchId ?? e.mint)}</code></td><td><small>${esc(e.payload.slice(0, 160))}</small></td></tr>`)
    .join('');

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(SERVICE.name)} ledger</title>
<style>
:root{--bg:#0b0d10;--fg:#e8eaed;--mut:#8b93a1;--line:#1f242c;--ok:#4ade80;--warn:#fbbf24;--bad:#f87171;--acc:#7dd3fc}
body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.45 ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
main{max-width:1100px;margin:0 auto;padding:32px 20px}
h1{font-size:22px;margin:0 0 4px}h2{font-size:15px;color:var(--mut);margin:28px 0 8px;text-transform:uppercase;letter-spacing:.06em}
p.lead{color:var(--mut);margin:0 0 20px}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px}
.stat{border:1px solid var(--line);border-radius:8px;padding:12px}.stat b{display:block;font-size:22px}.stat span{color:var(--mut);font-size:12px}
table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:8px 6px;border-bottom:1px solid var(--line);vertical-align:top}th{color:var(--mut);font-weight:500;font-size:12px}
code{font:12px ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--acc)}small{color:var(--mut)}
.s-completed{color:var(--ok)}.s-processing,.s-submitting,.s-awaiting_signature{color:var(--warn)}.s-failed,.s-failed_uncharged{color:var(--bad)}
a{color:var(--acc)}footer{color:var(--mut);margin-top:32px;font-size:12px}
.wrap{overflow-x:auto}
</style></head><body><main>
<h1>${esc(SERVICE.name)} ledger</h1>
<p class="lead">Every launch routed through StonkFlow, attributed to the wallet that paid for it. If it is not here, it did not happen.</p>
<div class="stats">
  <div class="stat"><b>${summary.launches}</b><span>launches routed</span></div>
  <div class="stat"><b>${summary.completed}</b><span>completed</span></div>
  <div class="stat"><b>${summary.distinctAgents}</b><span>distinct agents</span></div>
  <div class="stat"><b>${summary.self}</b><span>self-signed</span></div>
  <div class="stat"><b>${summary.managed}</b><span>managed</span></div>
  <div class="stat"><b>${summary.buybacks}</b><span>buybacks</span></div>
  <div class="stat"><b>${summary.forwards}</b><span>fee forwards</span></div>
</div>
<h2>Launches by quote asset</h2>
<div class="wrap"><table><thead><tr><th>Quote</th><th>Launches</th></tr></thead><tbody>${quoteRows || '<tr><td colspan="2"><small>none yet</small></td></tr>'}</tbody></table></div>
<h2>Recent launches</h2>
<div class="wrap"><table><thead><tr><th>When (UTC)</th><th>Coin</th><th>Quote</th><th>Mode</th><th>Signing</th><th>Agent</th><th>Status</th><th>Mint</th></tr></thead><tbody>${launchRows || '<tr><td colspan="8"><small>none yet</small></td></tr>'}</tbody></table></div>
<h2>Recent events</h2>
<div class="wrap"><table><thead><tr><th>When (UTC)</th><th>Kind</th><th>Ref</th><th>Payload</th></tr></thead><tbody>${eventRows || '<tr><td colspan="4"><small>none yet</small></td></tr>'}</tbody></table></div>
<footer>${esc(SERVICE.name)} v${SERVICE.version} · JSON at <a href="/v1/ledger.json">/v1/ledger.json</a> · API at <a href="/">/</a></footer>
</main></body></html>`;
}
