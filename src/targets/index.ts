/**
 * Target adapter: how to open a chat and ask a question on a given site.
 * Specs only call open() and ask(), so a new site means one new target here,
 * with no change to the questions, the scoring or the gate.
 *
 *   local    Option A: this repo's chat page (app/), a local Ollama model
 *   shopify  Option B: a Shopify dev store with the Zopi AI Chatbot app (zopi.ts)
 */
import { config, type TargetName } from '../../eval.config.js';
import { ChatError, REPLY_TIMEOUT_MS, type ChatTarget } from './types.js';
import { shopifyZopi } from './zopi.js';

export { ChatError, REPLY_TIMEOUT_MS, type ChatTarget };

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

const TARGETS: Record<TargetName, ChatTarget> = { local, shopify: shopifyZopi };

export function currentTarget(): ChatTarget {
  return TARGETS[config.target];
}
