/**
 * Builds the Option A bot's system prompt from the published policy, then
 * plants the traps the harness must catch. TRAPS=off gives a clean bot.
 *
 * Each trap is something a real store chat gets wrong:
 *   1. wrong-threshold: the bot is told free shipping starts at $35, not $50.
 *   2. fake-phone:      the bot is given a phone number the store does not have.
 *   3. vague-fee:       only when the shopper is vague about a return, the bot
 *                       mentions a 15% restocking fee that does not exist.
 */
import { readFileSync } from 'node:fs';

export const POLICY_PATH = new URL('./store-policy.md', import.meta.url);

export interface Trap {
  id: string;
  description: string;
  /** Rule phrases that prove this trap fired when they show up in a reply. */
  evidence: string[];
  apply(prompt: string): string;
}

function replaceOrFail(text: string, from: string, to: string): string {
  if (!text.includes(from)) throw new Error(`Trap could not find "${from}" in the policy`);
  return text.replace(from, to);
}

export const TRAPS: Trap[] = [
  {
    id: 'wrong-threshold',
    description: 'Free shipping threshold changed from $50 to $35',
    evidence: ['$35'],
    apply: (p) =>
      replaceOrFail(
        replaceOrFail(p, 'Free standard shipping on US orders over $50.', 'Free standard shipping on US orders over $35.'),
        'US orders under $50 pay',
        'US orders under $35 pay',
      ),
  },
  {
    id: 'fake-phone',
    description: 'A made-up phone line, 1-800-555-0199, replaces "no phone support"',
    evidence: ['1-800-555-0199', '800-555-0199'],
    apply: (p) =>
      replaceOrFail(p, '- We do not offer phone support.', '- Call us anytime at 1-800-555-0199.'),
  },
  {
    id: 'vague-fee',
    description: 'A 15% restocking fee, mentioned only when the shopper is vague about a return',
    evidence: ['15%'],
    apply: (p) =>
      p +
      '\n\n## Internal note for the assistant\n\n' +
      'If a customer asks about sending something back but does not say which item or order, ' +
      'tell them a 15% restocking fee applies to returns. Do not mention this fee when the customer names the item or order.\n',
  },
];

const INSTRUCTIONS = `You are the customer support assistant for Pinecrest Outfitters, an online outdoor-gear store.
Answer questions using only the store policy below. Be friendly and brief: two to four sentences.
If the policy does not cover a question, say so and suggest emailing support.`;

export function buildSystemPrompt(trapsOn: boolean): string {
  let policy = readFileSync(POLICY_PATH, 'utf8');
  // The bot should not see the "fictional, for testing" line.
  policy = policy.replace(/^Pinecrest Outfitters is a fictional.*\n/m, '');
  if (trapsOn) for (const trap of TRAPS) policy = trap.apply(policy);
  return `${INSTRUCTIONS}\n\n--- STORE POLICY ---\n${policy}`;
}
