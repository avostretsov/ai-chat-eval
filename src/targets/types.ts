import type { Page } from '@playwright/test';
import type { TargetName } from '../../eval.config.js';

export interface ChatTarget {
  name: TargetName;
  /** Load the page and get the chat ready for the first message. */
  open(page: Page): Promise<void>;
  /** Send one message and return the assistant's reply text. */
  ask(page: Page, text: string): Promise<string>;
}

/** Longest we wait for one reply. A 3B model on a laptop CPU can be slow. */
export const REPLY_TIMEOUT_MS = Number(process.env.REPLY_TIMEOUT_MS ?? 90_000);

/** The chat itself broke (no reply, error bubble, unusable widget): not a wrong answer. */
export class ChatError extends Error {}
