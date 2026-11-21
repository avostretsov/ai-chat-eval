/**
 * Where a run's raw evidence lives: runs/<RUN_ID>/{meta.json, replies/, screenshots/}.
 * Capturing and scoring are separate steps, so replies can be re-scored
 * (e.g. with a new rule or the judge turned on) without asking the bot again.
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

export const RUNS_DIR = resolve(process.env.RUNS_DIR ?? 'runs');

export interface Turn {
  user: string;
  bot: string;
  ms: number;
}

export interface Capture {
  questionId: string;
  run: number;
  target: string;
  status: 'ok' | 'error';
  error?: string;
  turns: Turn[];
  /** The last reply: the one the pass rules check. */
  reply: string;
  /** Path relative to the run folder, e.g. screenshots/<id>__run1.png. */
  screenshot: string;
  startedAt: string;
  durationMs: number;
}

export function newRunId(): string {
  return new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
}

export function runDir(runId: string) {
  return join(RUNS_DIR, runId);
}

export function captureFile(runId: string, questionId: string, run: number) {
  return join(runDir(runId), 'replies', `${questionId}__run${run}.json`);
}

export function screenshotFile(runId: string, questionId: string, run: number) {
  return join(runDir(runId), 'screenshots', `${questionId}__run${run}.png`);
}

export function writeJSON(file: string, data: unknown) {
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
}

export function markLatest(runId: string) {
  mkdirSync(RUNS_DIR, { recursive: true });
  writeFileSync(join(RUNS_DIR, 'latest.txt'), runId + '\n');
}

/** The run to read: RUN_ID if set, else the most recent one. */
export function latestRunId(): string {
  if (process.env.RUN_ID) return process.env.RUN_ID;
  const pointer = join(RUNS_DIR, 'latest.txt');
  if (!existsSync(pointer)) throw new Error('No runs yet. Capture one with `npm run capture`.');
  return readFileSync(pointer, 'utf8').trim();
}

export function readCaptures(runId: string): Capture[] {
  const dir = join(runDir(runId), 'replies');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')) as Capture);
}
