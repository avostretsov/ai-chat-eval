/**
 * Option B: a real Shopify dev store with the Zopi AI Chatbot app.
 *
 * What makes it harder than the local chat page, and how it is handled:
 *  - The storefront is password-protected      → enter the dev-store password from .env
 *  - The widget lives in an open shadow DOM     → Playwright CSS locators pierce it
 *  - Replies stream in over several seconds     → wait for the typing indicator to go
 *                                                 AND the text to stop changing
 *  - Replies can carry product cards / buttons  → read only the reply text
 *  - The widget remembers chats (visitor id)    → every test has a fresh browser context
 *  - A launcher style can auto-send a question  → open() fails if the chat isn't empty,
 *    ("Explore this product" on product pages)    so no reply is spent on a question we didn't ask
 *
 * Selectors were taken from the live widget on 2026-11-21. If Zopi changes its
 * markup, the widget contract test (tests/widget/zopi.spec.ts) shows what moved.
 */
import type { Page } from '@playwright/test';
import { config } from '../../eval.config.js';
import { ChatError, REPLY_TIMEOUT_MS, type ChatTarget } from './types.js';

export const ZOPI = {
  host: 'zopi-chat-widget',
  launcher: '#zopi-launcher',
  input: '#zopi-input',
  send: 'button[aria-label="Send message"]',
  messages: '#zopi-messages',
  /** Bot replies, not counting the greeting shown before anyone types. */
  botRows: '#zopi-messages > .zopi-msg-row.assistant:not(.zopi-welcome)',
  userRows: '#zopi-messages > .zopi-msg-wrap.user',
  /** Shown while the bot is still working on a reply. */
  busy: '.zopi-typing-bubble, .zopi-typing-dots, .zopi-status-bubble, .zopi-inline-status',
} as const;

/** How long the reply text must stay unchanged before it counts as finished. */
const SETTLE_MS = Number(process.env.REPLY_SETTLE_MS ?? 2_000);

/** Get past the dev-store password page, if it is shown. */
export async function unlockStorefront(page: Page, password: string) {
  if (!new URL(page.url()).pathname.startsWith('/password')) return;
  if (!password) throw new ChatError('The store is password-protected: set SHOPIFY_STORE_PASSWORD in .env');
  await page.locator('input[type="password"]').fill(password);
  await page.locator('input[type="password"]').press('Enter');
  await page.waitForURL((u) => !u.pathname.startsWith('/password'), { timeout: 15_000 }).catch(() => {
    throw new ChatError('The store password was not accepted');
  });
}

/** Reply text without avatar, name, timestamp, product cards or buttons. */
async function replyText(page: Page, index: number): Promise<string> {
  return page.locator(ZOPI.botRows).nth(index).evaluate((row) => {
    const bubble = (row.querySelector('.zopi-msg.assistant') ?? row).cloneNode(true) as HTMLElement;
    bubble.querySelectorAll('button, [class*="product"], [class*="card"], time, .zopi-msg-time').forEach((e) => e.remove());
    return (bubble.innerText ?? bubble.textContent ?? '').replace(/\n{3,}/g, '\n\n').trim();
  });
}

export const shopifyZopi: ChatTarget = {
  name: 'shopify',

  async open(page) {
    // Start where SHOPIFY_STORE_URL points: the home page by default (on product
    // pages some launcher styles send a question by themselves), or a preview
    // page when a bot is tested before launch.
    const start = config.targets.shopify.startPath;
    await page.goto(start);
    if (new URL(page.url()).pathname.startsWith('/password')) {
      await unlockStorefront(page, config.targets.shopify.password);
      // Shopify sends you to the home page after the password: go back to the start page.
      if (start !== '/') await page.goto(start);
    }
    const launcher = page.locator(ZOPI.launcher);
    await launcher.waitFor({ timeout: 30_000 }).catch(() => {
      throw new ChatError('No Zopi chat button on the page: is the app embed switched on in the theme?');
    });
    if ((await launcher.getAttribute('aria-expanded')) !== 'true') await launcher.click();
    await page.locator(ZOPI.input).waitFor({ state: 'visible' });

    // A fresh visitor should see only the greeting. Anything else means a
    // question was sent for us (and cost a reply), so this chat can't be used.
    // A short pause first, so an auto-sent question has time to show up.
    await page.waitForTimeout(1_000);
    const users = await page.locator(ZOPI.userRows).count();
    const bots = await page.locator(ZOPI.botRows).count();
    if (users || bots) throw new ChatError(`The chat already had ${users} shopper and ${bots} bot messages before the first question`);
  },

  async ask(page, text) {
    const rows = page.locator(ZOPI.botRows);
    const before = await rows.count();
    await page.locator(ZOPI.input).fill(text);
    await page.locator(ZOPI.send).click();

    await rows.nth(before).waitFor({ timeout: REPLY_TIMEOUT_MS }).catch(() => {
      throw new ChatError(`No reply within ${REPLY_TIMEOUT_MS / 1000} s`);
    });

    // Streaming: done when nothing shows "busy" and the text has not changed for SETTLE_MS.
    const deadline = Date.now() + REPLY_TIMEOUT_MS;
    let last = '';
    let stableSince = Date.now();
    while (Date.now() < deadline) {
      const now = await replyText(page, before);
      const busy = await page.locator(ZOPI.busy).filter({ visible: true }).count();
      if (now !== last || busy) {
        last = now;
        stableSince = Date.now();
      } else if (now && Date.now() - stableSince >= SETTLE_MS) {
        return now;
      }
      await page.waitForTimeout(250);
    }
    throw new ChatError(`The reply did not finish within ${REPLY_TIMEOUT_MS / 1000} s`);
  },
};
