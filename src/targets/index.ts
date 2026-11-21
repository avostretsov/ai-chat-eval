/**
 * Target adapter: how to open a chat and ask a question on a given site.
 * Specs only call open() and ask(), so adding Option B (a Shopify widget with
 * iframes and slow replies) in Weekend 2 means adding one target here.
 */
import type { Page } from '@playwright/test';
import { config, type TargetName } from '../../eval.config.js';

export interface ChatTarget {
  name: TargetName;
  /** Load the page and get the chat ready for the first message. */
  open(page: Page): Promise<void>;
  /** Send one message and return the assistant's reply text. */
  ask(page: Page, text: string): Promise<string>;
}

/** Longest we wait for one reply. A 3B model on a laptop CPU can be slow. */
export const REPLY_TIMEOUT_MS = Number(process.env.REPLY_TIMEOUT_MS ?? 90_000);

export class ChatError extends Error {}

const local: ChatTarget = {
  name: 'local',
  async open(page) {
    await page.goto('/');
    await page.getByTestId('chat-input').waitFor();
  },
  async ask(page, text) {
    const replies = page.locator('[data-testid="msg-bot"], [data-testid="msg-error"]');
    const before = await replies.count();
    await page.getByTestId('chat-input').fill(text);
    await page.getByTestId('chat-send').click();
    // Wait for a new bot (or error) bubble, not a fixed sleep: reply time varies.
    await replies.nth(before).waitFor({ timeout: REPLY_TIMEOUT_MS });
    const last = replies.nth(before);
    const text_ = (await last.innerText()).trim();
    if ((await last.getAttribute('data-testid')) === 'msg-error') throw new ChatError(text_);
    return text_;
  },
};

const shopify: ChatTarget = {
  name: 'shopify',
  async open() {
    throw new Error('TARGET=shopify is planned for Weekend 2 (Option B) and is not built yet.');
  },
  async ask() {
    throw new Error('TARGET=shopify is not built yet.');
  },
};

const TARGETS: Record<TargetName, ChatTarget> = { local, shopify };

export function currentTarget(): ChatTarget {
  return TARGETS[config.target];
}
