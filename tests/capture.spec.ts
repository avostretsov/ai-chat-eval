/**
 * Capture: ask every question REPEATS times, each in a fresh browser context
 * (Playwright gives every test its own), and save the reply text, the whole
 * chat and a screenshot. Scoring is a separate step that reads these files.
 *
 * A test fails here only if the chat itself broke (no reply, error bubble).
 * Wrong answers are not failures yet: that is the scorer's job.
 */
import { test, expect } from '@playwright/test';
import { config } from '../eval.config.js';
import { loadQuestions } from '../src/questions.js';
import { currentTarget } from '../src/targets/index.js';
import { captureFile, markLatest, runDir, screenshotFile, writeJSON, type Capture, type Turn } from '../src/runs.js';
import { existsSync } from 'node:fs';
import { join, relative } from 'node:path';

// Loading validates the pass rules: a malformed rule stops the run before any question.
const { questions } = loadQuestions();
const target = currentTarget();
const runId = process.env.RUN_ID!;

// Record what this run used (model, traps, judge), once per run.
test.beforeAll(async () => {
  const metaFile = join(runDir(runId), 'meta.json');
  if (existsSync(metaFile)) return;
  const bot =
    config.target === 'local'
      ? await fetch(`${config.targets.local.baseURL}/api/health`).then((r) => r.json()).catch(() => null)
      : null;
  writeJSON(metaFile, {
    runId,
    startedAt: new Date().toISOString(),
    target: config.target,
    bot,
    judge: config.judge,
    repeats: config.repeats,
    questions: questions.length,
    questionFile: process.env.QUESTIONS ?? 'questions/pinecrest.yaml',
  });
  markLatest(runId);
});

for (const q of questions) {
  for (let run = 1; run <= config.repeats; run++) {
    test(`${q.id} · run ${run}`, { tag: [`@${q.severity}`, `@${q.topic}`, `@${q.shopper}`] }, async ({ page }, testInfo) => {
      const started = Date.now();
      const turns: Turn[] = [];
      const shot = screenshotFile(runId, q.id, run);
      let error: string | undefined;

      try {
        await target.open(page);
        for (const text of q.turns) {
          const t0 = Date.now();
          const bot = await target.ask(page, text);
          turns.push({ user: text, bot, ms: Date.now() - t0 });
        }
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
      } finally {
        await page.screenshot({ path: shot, fullPage: true }).catch(() => {});
        const capture: Capture = {
          questionId: q.id,
          run,
          target: target.name,
          status: error ? 'error' : 'ok',
          ...(error ? { error } : {}),
          turns,
          reply: turns.at(-1)?.bot ?? '',
          screenshot: relative(runDir(runId), shot), // relative, so a run folder can be moved
          startedAt: new Date(started).toISOString(),
          durationMs: Date.now() - started,
        };
        writeJSON(captureFile(runId, q.id, run), capture);
        await testInfo.attach('chat', { body: turns.map((t) => `Shopper: ${t.user}\nBot: ${t.bot}`).join('\n\n'), contentType: 'text/plain' });
        await testInfo.attach('screenshot', { path: shot, contentType: 'image/png' }).catch(() => {});
      }

      expect(error, 'the chat should answer every turn').toBeUndefined();
      expect(turns.at(-1)?.bot, 'the last reply should not be empty').toBeTruthy();
    });
  }
}
