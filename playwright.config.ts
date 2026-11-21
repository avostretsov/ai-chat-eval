import { defineConfig, devices } from '@playwright/test';
import { config, baseURL } from './eval.config.js';
import { existsSync } from 'node:fs';
import { latestRunId, newRunId, RUNS_DIR } from './src/runs.js';

// A capture starts a new run: one id, set here in the main process so every
// worker (spawned later) inherits it. Without a capture (unit, gate only), the
// gate reads RUN_ID if given, else the latest run.
// Decided once in the main process; workers re-read this file without the
// CLI flags, so they must find RUN_ID already set.
if (!process.env.RUN_ID) {
  if (runsCapture()) process.env.RUN_ID = newRunId();
  else if (existsSync(`${RUNS_DIR}/latest.txt`)) process.env.RUN_ID = latestRunId();
}

/** False when only offline projects (unit, gate) were selected. */
function runsCapture() {
  const picked: string[] = [];
  process.argv.forEach((a, i) => {
    if (a === '--project') picked.push(process.argv[i + 1]);
    else if (a.startsWith('--project=')) picked.push(a.split('=')[1]);
  });
  return picked.length === 0 || picked.includes('capture');
}

export default defineConfig({
  testDir: './tests',
  // One local model answers one question at a time; parallel workers would
  // only queue on Ollama and make reply times noisy.
  workers: 1,
  fullyParallel: false,
  timeout: 5 * 60_000,
  retries: 0,
  reporter: [['list'], ['html', { outputFolder: process.env.REPORT_DIR ?? 'playwright-report', open: 'never' }]],
  use: {
    baseURL: baseURL(),
    ...devices['Desktop Chrome'],
    trace: 'retain-on-failure',
  },
  projects: [
    // Scoring logic only: no browser, no model, no server.
    { name: 'unit', testMatch: 'unit/**/*.spec.ts' },
    // Ask the bot and save evidence. The project name is the target.
    { name: 'capture', testMatch: 'capture.spec.ts', use: { ...devices['Desktop Chrome'] } },
    // Score a captured run and fail on any critical failure: the ship/block gate.
    // Plain `playwright test` runs capture first, then the gate on that run.
    // `npm run gate` uses --no-deps to gate an existing run without asking the bot.
    { name: 'gate', testMatch: 'gate.spec.ts', dependencies: ['capture'] },
  ],
  // Option A: start the local chat page (only the capture project talks to it).
  webServer:
    config.target === 'local' && runsCapture()
      ? {
          command: 'npm run bot',
          url: `${baseURL()}/api/health`,
          reuseExistingServer: true,
          timeout: 30_000,
        }
      : undefined,
});
