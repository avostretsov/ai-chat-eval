/**
 * `npm run report`: turn runs/<id>/results.json into one self-contained page,
 * runs/<id>/summary.html: the topic × shopper heatmap, severity counts, the
 * stability list, trap status and every reply with its screenshot.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadQuestions, TOPICS, SHOPPERS, SEVERITIES } from '../questions.js';
import { latestRunId, runDir } from '../runs.js';
import { TRAPS } from '../../app/bot-prompt.js';
import type { ScoredReply } from '../score-cli.js';
import type { QuestionStability } from '../scoring/consistency.js';

interface Results {
  runId: string;
  judge: string;
  scoredAt: string;
  stabilityScore: { stable: number; total: number; pct: number };
  stability: QuestionStability[];
  results: ScoredReply[];
}

const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const VERDICT_CLASS: Record<string, string> = {
  Correct: 'ok', Partly: 'minor', Wrong: 'bad', 'Made up': 'bad', Dodged: 'major', 'Needs review': 'review', Error: 'bad',
};

/** Pass rate → colour on a red → amber → green ramp (hue 0..135). */
function heatColor(rate: number) {
  return `hsl(${Math.round(rate * 135)} 62% var(--heat-l))`;
}

export function buildReport(runId: string): string {
  const dir = runDir(runId);
  const file = join(dir, 'results.json');
  if (!existsSync(file)) throw new Error(`No results for run ${runId}. Run \`npm run score\` first.`);
  const data: Results = JSON.parse(readFileSync(file, 'utf8'));
  const meta = existsSync(join(dir, 'meta.json')) ? JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8')) : {};
  const { questions } = loadQuestions();
  const rs = data.results;

  // ── Headline numbers
  const decided = rs.filter((r) => r.outcome !== 'review');
  const passed = rs.filter((r) => r.outcome === 'pass').length;
  const passPct = decided.length ? Math.round((100 * passed) / decided.length) : 0;
  const review = rs.filter((r) => r.outcome === 'review').length;
  const sevCount = Object.fromEntries(
    SEVERITIES.map((s) => [s, rs.filter((r) => r.outcome === 'fail' && r.severity === s).length]),
  ) as Record<string, number>;
  const blocked = sevCount.critical > 0;

  // ── Heatmap cells
  const cell = (t: string, s: string) => {
    const inCell = rs.filter((r) => r.topic === t && r.shopper === s);
    const dec = inCell.filter((r) => r.outcome !== 'review');
    const pass = inCell.filter((r) => r.outcome === 'pass').length;
    const rev = inCell.length - dec.length;
    const qn = new Set(inCell.map((r) => r.questionId)).size;
    if (!inCell.length) return `<td class="cell empty">—</td>`;
    if (!dec.length) return `<td class="cell undecided"><b>?</b><small>${rev} to review</small></td>`;
    const rate = pass / dec.length;
    return `<td class="cell" style="background:${heatColor(rate)}" title="${qn} question(s), ${inCell.length} replies">
      <b>${Math.round(rate * 100)}%</b><small>${pass}/${dec.length} passed${rev ? ` · ${rev} review` : ''}</small></td>`;
  };
  const heatmap = `<table class="heat">
    <thead><tr><th></th>${SHOPPERS.map((s) => `<th>${esc(s)}</th>`).join('')}</tr></thead>
    <tbody>${TOPICS.map((t) => `<tr><th scope="row">${esc(t)}</th>${SHOPPERS.map((s) => cell(t, s)).join('')}</tr>`).join('')}</tbody>
  </table>`;

  // ── Traps: a trap counts as fired only when its own claim shows up in a reply,
  // on the questions aimed at it or anywhere else.
  const trapRows = TRAPS.map((trap) => {
    const fired = (r: ScoredReply) => [...r.wrongClaims, ...r.madeUpClaims].some((c) => trap.evidence.includes(c));
    const aimed = rs.filter((r) => r.trap === trap.id);
    const caught = aimed.filter(fired);
    const elsewhere = rs.filter((r) => r.trap !== trap.id && fired(r)).length;
    const total = caught.length + elsewhere;
    const status = total ? 'Caught' : meta.bot && !meta.bot.traps ? 'Traps off' : 'Did not fire';
    return `<tr><td><code>${esc(trap.id)}</code></td><td>${esc(trap.description)}</td>
      <td><span class="chip ${total ? 'bad' : 'review'}">${status}</span></td>
      <td>${caught.length}/${aimed.length} targeted replies${elsewhere ? ` · ${elsewhere} elsewhere` : ''}</td></tr>`;
  }).join('');

  // ── Stability list
  const unstable = data.stability.filter((s) => !s.stable);
  const stabilityRows = unstable.length
    ? unstable
        .map(
          (s) => `<tr><td><a href="#q-${esc(s.questionId)}">${esc(s.questionId)}</a></td>
        <td>${s.verdicts.map((v) => `<span class="chip ${VERDICT_CLASS[v]}">${esc(v)}</span>`).join('<span class="arrow">→</span>')}</td>
        <td>${s.outcomeFlipped ? 'Pass/fail flipped' : 'Label changed'}</td></tr>`,
        )
        .join('')
    : `<tr><td colspan="3">Every question got the same verdict in every run.</td></tr>`;

  // ── Every question, every run
  const detail = questions
    .map((q) => {
      const runs = rs.filter((r) => r.questionId === q.id);
      if (!runs.length) return '';
      return `<details class="q" id="q-${esc(q.id)}">
        <summary>
          <span class="qid">${esc(q.id)}</span>
          <span class="meta">${esc(q.topic)} · ${esc(q.shopper)} · <span class="sev ${q.severity}">${q.severity}</span></span>
          <span class="chips">${runs.map((r) => `<span class="chip ${VERDICT_CLASS[r.verdict]}">${esc(r.verdict)}</span>`).join('')}</span>
        </summary>
        <p class="ask">${q.turns.map((t) => `<span>Shopper: ${esc(t)}</span>`).join('')}</p>
        ${runs
          .map(
            (r) => `<div class="run">
            <div class="run-head"><b>Run ${r.run}</b> <span class="chip ${VERDICT_CLASS[r.verdict]}">${esc(r.verdict)}</span>
              ${r.severity ? `<span class="sev ${r.severity}">${r.severity}</span>` : ''}${r.decidedBy !== 'rules' ? ` <span class="chip review" title="${esc(r.decidedBy)}">⚖ judge</span>` : ''}${r.judge && r.decidedBy === 'rules' ? ` <span class="chip review" title="Advisory: ${esc(r.judge.by)}">⚖ suggests ${esc(r.judge.verdict)}</span>` : ''} <span class="reason">${esc(r.reason)}</span></div>
            <blockquote>${esc(r.reply)}</blockquote>
            ${r.screenshot && existsSync(join(dir, r.screenshot)) ? `<a href="${esc(r.screenshot)}" target="_blank">Screenshot</a>` : ''}
          </div>`,
          )
          .join('')}
        <p class="src">Answer key: <code>${esc(q.source)}</code></p>
      </details>`;
    })
    .join('');

  const bot = meta.bot ? `${esc(meta.bot.provider)} / ${esc(meta.bot.model)} · traps ${meta.bot.traps ? 'on' : 'off'}` : esc(meta.target ?? '');

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Chat Eval Report</title>
<style>
:root{--bg:#f6f7f5;--panel:#fff;--ink:#1d2421;--muted:#66706b;--line:#e1e5e2;--heat-l:78%;
  --ok:#1f7a4a;--ok-bg:#dcf1e4;--bad:#a8231c;--bad-bg:#fbe0dd;--major:#8a4b00;--major-bg:#fdebd3;
  --minor:#5b5f00;--minor-bg:#f3f1cf;--review:#4a4f86;--review-bg:#e4e6f7}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#121614;--panel:#1a201d;--ink:#e3e8e5;--muted:#95a09a;--line:#2b332f;--heat-l:34%;
  --ok:#7fd3a3;--ok-bg:#173826;--bad:#ff9a90;--bad-bg:#45201c;--major:#ffc27a;--major-bg:#3f2a10;--minor:#e2dc86;--minor-bg:#34331a;--review:#b4b9f5;--review-bg:#262a4a}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 system-ui,-apple-system,sans-serif}
main{max-width:1040px;margin:0 auto;padding:24px 16px 64px}
h1{font-size:1.5rem;margin:0 0 4px}h2{font-size:1.1rem;margin:36px 0 12px}
.sub{color:var(--muted);margin:0 0 20px}
.gate{display:flex;align-items:center;gap:12px;padding:14px 18px;border-radius:12px;font-weight:600;margin-bottom:20px}
.gate.block{background:var(--bad-bg);color:var(--bad)}.gate.ship{background:var(--ok-bg);color:var(--ok)}
.gate span{font-weight:400}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px}
.tile{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:14px 16px}
.tile b{display:block;font-size:1.6rem;font-variant-numeric:tabular-nums}.tile small{color:var(--muted)}
.panel{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:16px;overflow-x:auto}
table{border-collapse:collapse;width:100%}th,td{text-align:left;padding:8px 10px;border-bottom:1px solid var(--line);vertical-align:top}
.heat{border-collapse:separate;border-spacing:6px;min-width:520px}.heat th{border:0;color:var(--muted);font-weight:600;text-transform:capitalize}
.heat thead th{text-align:center}
.cell{border:0;border-radius:10px;text-align:center;padding:14px 8px;color:#111;min-width:120px}
.cell b{display:block;font-size:1.35rem;font-variant-numeric:tabular-nums}.cell small{opacity:.8}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]) .cell{color:#f2f5f3}}
.cell.undecided{background:var(--review-bg);color:var(--review)}.cell.empty{background:transparent;color:var(--muted)}
.legend{display:flex;align-items:center;gap:8px;color:var(--muted);font-size:.85rem;margin-top:10px}
.legend i{display:inline-block;width:120px;height:10px;border-radius:5px;background:linear-gradient(90deg,hsl(0 62% var(--heat-l)),hsl(67 62% var(--heat-l)),hsl(135 62% var(--heat-l)))}
.chip{display:inline-block;padding:1px 9px;border-radius:999px;font-size:.8rem;font-weight:600;white-space:nowrap}
.chip.ok{background:var(--ok-bg);color:var(--ok)}.chip.bad{background:var(--bad-bg);color:var(--bad)}
.chip.major{background:var(--major-bg);color:var(--major)}.chip.minor{background:var(--minor-bg);color:var(--minor)}
.chip.review{background:var(--review-bg);color:var(--review)}
.arrow{color:var(--muted);margin:0 4px}
.sev{font-size:.75rem;font-weight:700;text-transform:uppercase;letter-spacing:.04em}
.sev.critical{color:var(--bad)}.sev.major{color:var(--major)}.sev.minor{color:var(--minor)}
details.q{background:var(--panel);border:1px solid var(--line);border-radius:12px;margin-bottom:8px}
details.q summary{cursor:pointer;padding:12px 16px;display:flex;flex-wrap:wrap;gap:6px 14px;align-items:center}
.qid{font-weight:600;font-family:ui-monospace,monospace;font-size:.9rem}.meta{color:var(--muted);font-size:.85rem}
.chips{display:flex;gap:4px;margin-left:auto;flex-wrap:wrap}
.ask{margin:0 16px 8px;display:flex;flex-direction:column;color:var(--muted)}
.run{margin:0 16px 12px;padding-top:10px;border-top:1px solid var(--line)}
.run-head{display:flex;flex-wrap:wrap;gap:8px;align-items:center}.reason{color:var(--muted);font-size:.88rem}
blockquote{margin:8px 0;padding:8px 12px;border-left:3px solid var(--line);white-space:pre-wrap;overflow-wrap:anywhere}
.src{margin:0 16px 14px;color:var(--muted);font-size:.85rem}a{color:inherit}
code{font-family:ui-monospace,monospace;font-size:.88em}
</style></head><body><main>
<section id="overview">
<h1>Chat eval: ${esc(meta.target === 'local' ? 'Pinecrest Outfitters (Option A, local)' : meta.target ?? '')}</h1>
<p class="sub">Run <code>${esc(data.runId)}</code> · ${rs.length} replies (${new Set(rs.map((r) => r.questionId)).size} questions × ${esc(meta.repeats ?? '?')} runs) · bot: ${bot} · judge: ${esc(data.judge)}</p>

<div class="gate ${blocked ? 'block' : 'ship'}">${blocked ? 'BLOCK' : 'SHIP'}
  <span>${blocked ? `${sevCount.critical} critical failure(s): a wrong or made-up promise about money or policy.` : 'No critical failures.'}</span></div>

<div class="tiles">
  <div class="tile"><b>${passPct}%</b><small>pass rate (${passed}/${decided.length} decided)</small></div>
  <div class="tile"><b>${data.stabilityScore.pct}%</b><small>stable (${data.stabilityScore.stable}/${data.stabilityScore.total} same every run)</small></div>
  <div class="tile"><b style="color:var(--bad)">${sevCount.critical}</b><small>critical failures</small></div>
  <div class="tile"><b style="color:var(--major)">${sevCount.major}</b><small>major failures</small></div>
  <div class="tile"><b style="color:var(--minor)">${sevCount.minor}</b><small>minor failures</small></div>
  <div class="tile"><b style="color:var(--review)">${review}</b><small>need human review</small></div>
</div>

<h2>Pass rate by topic × shopper type</h2>
<div class="panel">${heatmap}
  <div class="legend">0%<i></i>100% · pass rate over decided replies; "review" replies are not counted</div></div>
</section>

<h2>Stability: questions whose verdict changed between runs</h2>
<div class="panel"><table><thead><tr><th>Question</th><th>Verdicts, run by run</th><th>Change</th></tr></thead><tbody>${stabilityRows}</tbody></table></div>

<h2>Planted traps</h2>
<div class="panel"><table><thead><tr><th>Trap</th><th>What was planted</th><th>Status</th><th>Replies where it fired</th></tr></thead><tbody>${trapRows}</tbody></table></div>

<h2>Every question</h2>
${detail}
</main></body></html>`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const runId = latestRunId();
  const out = join(runDir(runId), 'summary.html');
  writeFileSync(out, buildReport(runId));
  console.log(`Report: ${out}`);
}
