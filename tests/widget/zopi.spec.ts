/**
 * Widget contract test for the Shopify target, against a local mock of the
 * Zopi widget (no network, no store, no AI replies spent). It pins down what
 * the adapter relies on: getting past the password page, opening the chat,
 * waiting for a streamed reply to finish, reading only the reply text, and
 * refusing a chat that already had a question sent for us.
 */
import { test, expect } from '@playwright/test';
import { config } from '../../eval.config.js';
import { shopifyZopi, unlockStorefront } from '../../src/targets/zopi.js';
import { MOCK_ORIGIN, askedOn, serveMockStore } from './zopi-mock.js';

// The adapter enters the password from .env; the mock accepts exactly that
// value, and the request never leaves the machine (page.route answers it).
const password = config.targets.shopify.password;
test.use({ baseURL: MOCK_ORIGIN });
test.skip(!config.targets.shopify.password, 'Set SHOPIFY_STORE_PASSWORD (any value works for the mock)');

test('opens the chat behind the password page and reads a streamed reply in full', async ({ page }) => {
  await serveMockStore(page, password, { autoSend: false });
  await shopifyZopi.open(page);
  const reply = await shopifyZopi.ask(page, 'what is the free shipping threshold?');
  // Both parts, across the 1 s pause in the stream; no avatar, name or timestamp.
  expect(reply).toBe('We offer free standard shipping on US orders over $50. Orders under $50 pay $6.95.');
  expect(await askedOn(page)).toEqual(['what is the free shipping threshold?']);
});

test('reads only the reply text, not the product card under it', async ({ page }) => {
  await serveMockStore(page, password, { autoSend: false });
  await shopifyZopi.open(page);
  const reply = await shopifyZopi.ask(page, 'tell me about the backpack');
  expect(reply).toBe('The Summit 45 backpack holds 45 liters.');
  expect(reply).not.toContain('$179.00');
});

test('multi-turn: each ask returns its own reply', async ({ page }) => {
  await serveMockStore(page, password, { autoSend: false });
  await shopifyZopi.open(page);
  expect(await shopifyZopi.ask(page, 'hello')).toBe('Mock answer to: hello');
  expect(await shopifyZopi.ask(page, 'and shipping?')).toContain('$50');
});

test('waits for a second message and joins it ("allow me a moment" → answer)', async ({ page }) => {
  await serveMockStore(page, password, { autoSend: false });
  await shopifyZopi.open(page);
  const reply = await shopifyZopi.ask(page, 'return window. now.');
  expect(reply).toBe('Please allow me a moment to retrieve the specific details for you.\n\nYou can return items within 30 days of delivery.');
});

test('refuses a chat that already had a question sent for us', async ({ page }) => {
  await serveMockStore(page, password, { autoSend: true });
  await expect(shopifyZopi.open(page)).rejects.toThrow(/already had 1 shopper/);
});

test('reports a wrong store password clearly', async ({ page }) => {
  await serveMockStore(page, password, { autoSend: false });
  await page.goto('/');
  await expect(unlockStorefront(page, 'wrong-password')).rejects.toThrow('The store password was not accepted');
});
