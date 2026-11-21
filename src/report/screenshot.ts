/**
 * `npm run report:png`: save the report's overview (gate, tiles, heatmap) as
 * docs/heatmap.png, the image the README shows.
 */
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { latestRunId, runDir } from '../runs.js';

const runId = latestRunId();
const out = resolve('docs/heatmap.png');
mkdirSync('docs', { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1100, height: 900 }, deviceScaleFactor: 2, colorScheme: 'light' });
await page.goto(pathToFileURL(join(runDir(runId), 'summary.html')).href);
await page.addStyleTag({ content: '#overview{padding:24px;background:var(--bg)}' });
await page.locator('#overview').screenshot({ path: out });
await browser.close();
console.log(`Saved ${out}`);
