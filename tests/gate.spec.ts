/**
 * Ship/block gate. Scores a captured run (default: the latest) with the
 * current pass rules and makes one test per question.
 *
 *   critical failure in ANY run  → the test fails → the run exits non-zero → BLOCK
 *   major / minor / needs review → the test passes with a warning annotation
 *
 * One critical failure out of three runs still blocks: a bot that promises the
 * wrong price one time in three will do it to real shoppers.
 *
 * Needs no browser and no model, so it runs in CI on a recorded run.
 */
import { test, expect } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadQuestions } from '../src/questions.js';
import { latestRunId, runDir } from '../src/runs.js';
import { scoreAndSave } from '../src/score-cli.js';
import { buildReport } from '../src/report/build.js';
import { isCriticalFailure } from '../src/scoring/gate.js';

// Tests are listed from the question file; the run is scored only when the
// gate actually executes (after capture, when both run in one command).
const { questions } = loadQuestions();

let scored: (ReturnType<typeof scoreAndSave> & { runId: string; summaryFile: string }) | undefined;
function gateRun() {
  if (!scored) {
    const runId = latestRunId();
    const summaryFile = join(runDir(runId), 'summary.html');
    const s = scoreAndSave(runId);
    writeFileSync(summaryFile, buildReport(runId));
    scored = { ...s, runId, summaryFile };
  }
  return scored;
}

test.describe('ship/block gate', () => {
  test('summary report', async ({}, testInfo) => {
    const { summaryFile, score, runId } = gateRun();
    testInfo.annotations.push({ type: 'run', description: runId });
    await testInfo.attach('summary.html', { path: summaryFile, contentType: 'text/html' });
    testInfo.annotations.push({ type: 'stability', description: `${score.stable}/${score.total} questions stable (${score.pct}%)` });
  });

  for (const q of questions) {
    test(`${q.id}`, { tag: [`@${q.severity}`, `@${q.topic}`, `@${q.shopper}`] }, async ({}, testInfo) => {
      const runs = gateRun().results.filter((r) => r.questionId === q.id);
      test.skip(runs.length === 0, 'not captured in this run');
      for (const r of runs) {
        if (r.outcome === 'pass') continue;
        testInfo.annotations.push({
          type: r.outcome === 'review' ? 'needs review' : `${r.severity} failure`,
          description: `run ${r.run}: ${r.verdict}: ${r.reason}`,
        });
      }
      await testInfo.attach('replies', {
        body: runs.map((r) => `Run ${r.run} · ${r.verdict}\n${r.reply}`).join('\n\n'),
        contentType: 'text/plain',
      });

      const critical = runs.filter(isCriticalFailure);
      expect(
        critical.map((r) => `run ${r.run}: ${r.verdict}: ${r.reason}`),
        `critical failures block the release (${q.source})`,
      ).toEqual([]);
    });
  }
});
