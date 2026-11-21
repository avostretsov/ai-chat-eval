/**
 * Unit tests for checks 1–3. No browser, no model: they pin down how a reply
 * is read, so a scoring change can't silently flip a verdict.
 */
import { test, expect } from '@playwright/test';
import { normalize, containsPhrase } from '../../src/scoring/normalize.js';
import { scoreReply } from '../../src/scoring/score.js';
import { stabilityByQuestion, stabilityScore } from '../../src/scoring/consistency.js';
import { gate } from '../../src/scoring/gate.js';
import type { Question } from '../../src/questions.js';

const DODGES = ["i don't have that information", 'please log in'];

function q(over: Partial<Question>): Question {
  return {
    id: 't', topic: 'shipping', shopper: 'clear', severity: 'critical', source: '/policy',
    turns: ['?'], must_contain: [], must_not_contain: [], made_up: [], answerable: true, declines: [], ...over,
  };
}

test.describe('normalize', () => {
  for (const [input, expected] of [
    ['Free over $50.00!', 'free over $50!'],
    ['fifty dollars', '$50'],
    ['50 USD', '$50'],
    ['$ 179', '$179'],
    ['thirty days', '30 days'],
    ['twenty-five', '25'],
    ['5–10 business days', '5-10 business days'],
    ['5 - 7 days', '5-7 days'],
    ['3,000 mm', '3000 mm'],
    ['You’re  all set', "you're all set"],
    ['$49.99', '$49.99'],
  ] as const) {
    test(`"${input}" → "${expected}"`, () => expect(normalize(input)).toBe(expected));
  }
});

test.describe('containsPhrase (whole words)', () => {
  const has = (text: string, phrase: string) => containsPhrase(normalize(text), phrase);
  test('money matches across formats', () => {
    expect(has('Orders over fifty dollars ship free', '$50')).toBe(true);
    expect(has('Orders over $50.00 ship free', '$50')).toBe(true);
  });
  test('$50 does not match $500 or $50.50', () => {
    expect(has('over $500', '$50')).toBe(false);
    expect(has('over $50.50', '$50')).toBe(false);
  });
  test('"us" does not match inside "customers"', () => {
    expect(has('Our customers love it', 'us')).toBe(false);
    expect(has('Free in the US.', 'us')).toBe(true);
  });
  test('ranges match with any dash', () => expect(has('takes 5 – 10 days', '5-10')).toBe(true));
});

test.describe('scoreReply verdicts', () => {
  const ship = q({ must_contain: ['$50'], must_not_contain: ['$35'] });

  test('Correct: all facts, nothing false', () => {
    const r = scoreReply(ship, 'Free standard shipping on US orders over $50.', DODGES);
    expect(r.verdict).toBe('Correct');
    expect(r.outcome).toBe('pass');
  });
  test('Wrong: the planted $35 threshold', () => {
    const r = scoreReply(ship, 'You get free shipping over $35.', DODGES);
    expect([r.verdict, r.severity]).toEqual(['Wrong', 'critical']);
  });
  test('Made up outranks a correct fact', () => {
    const ret = q({ must_contain: ['30 days'], made_up: ['15%'] });
    const r = scoreReply(ret, 'You have 30 days, and a 15% restocking fee applies.', DODGES);
    expect(r.verdict).toBe('Made up');
  });
  test('Partly: some facts missing → minor', () => {
    const two = q({ must_contain: ['$12', ['5-10', '5 to 10']] });
    const r = scoreReply(two, 'Shipping to Canada is $12.', DODGES);
    expect([r.verdict, r.severity]).toEqual(['Partly', 'minor']);
    expect(r.factsMissing).toEqual(['5-10']);
  });
  test('Dodged: no fact and a dodge phrase → major', () => {
    const r = scoreReply(ship, "Sorry, I don't have that information.", DODGES);
    expect([r.verdict, r.severity]).toEqual(['Dodged', 'major']);
  });
  test('Needs review: no fact, no false claim, no dodge', () => {
    const r = scoreReply(ship, 'Shipping is free above a certain amount.', DODGES);
    expect(r.outcome).toBe('review');
  });
  test('unanswerable: declining is Correct, inventing is Made up', () => {
    const pm = q({ answerable: false, made_up: ['match or beat'] });
    expect(scoreReply(pm, 'Our policy does not cover that. Please email support@pinecrest-outfitters.example.', DODGES).verdict).toBe('Correct');
    expect(scoreReply(pm, "We'll match or beat the price!", DODGES).verdict).toBe('Made up');
  });
  test('unanswerable: a plain "no" from the declines list is Correct, unless it also invents', () => {
    const pm = q({ answerable: false, made_up: ['match or beat'], declines: ['not offer price matching'] });
    expect(scoreReply(pm, 'We do not offer price matching for items at other stores.', DODGES).verdict).toBe('Correct');
    expect(scoreReply(pm, "We don't offer price matching, but we'll match or beat it this time!", DODGES).verdict).toBe('Made up');
    expect(scoreReply(pm, 'Price matching? Great question about our pricing.', DODGES).verdict).toBe('Needs review');
  });
  test('Error: the chat failed', () => {
    expect(scoreReply(ship, '', DODGES, { error: 'timeout' }).verdict).toBe('Error');
  });
});

test.describe('stability across repeat runs', () => {
  const rv = (questionId: string, run: number, verdict: any, outcome: any, severity?: any) => ({ questionId, run, verdict, outcome, severity });

  test('same verdict every run is stable', () => {
    const [s] = stabilityByQuestion([rv('a', 1, 'Correct', 'pass'), rv('a', 2, 'Correct', 'pass'), rv('a', 3, 'Correct', 'pass')]);
    expect(s.stable).toBe(true);
    expect(s.outcomeFlipped).toBe(false);
  });
  test('right twice, made up once: flagged, and the worst severity is kept', () => {
    const [s] = stabilityByQuestion([
      rv('a', 1, 'Correct', 'pass'),
      rv('a', 2, 'Made up', 'fail', 'critical'),
      rv('a', 3, 'Correct', 'pass'),
    ]);
    expect(s.stable).toBe(false);
    expect(s.outcomeFlipped).toBe(true);
    expect(s.worstSeverity).toBe('critical');
    expect(s.verdicts).toEqual(['Correct', 'Made up', 'Correct']);
  });
  test('stability score counts only repeated questions', () => {
    const qs = stabilityByQuestion([
      rv('a', 1, 'Correct', 'pass'), rv('a', 2, 'Correct', 'pass'),
      rv('b', 1, 'Wrong', 'fail', 'critical'), rv('b', 2, 'Partly', 'fail', 'minor'),
      rv('c', 1, 'Correct', 'pass'),
    ]);
    expect(stabilityScore(qs)).toEqual({ stable: 1, total: 2, pct: 50 });
  });
});

test.describe('ship/block gate rule', () => {
  const r = (questionId: string, run: number, outcome: any, severity?: any) => ({ questionId, run, outcome, severity, verdict: '', reason: '' });

  test('SHIP when nothing critical failed, even with major, minor and review results', () => {
    expect(gate([r('a', 1, 'pass'), r('b', 1, 'fail', 'major'), r('c', 1, 'fail', 'minor'), r('d', 1, 'review')])).toEqual({ decision: 'SHIP', blocking: [] });
  });
  test('BLOCK when one run out of three failed critically', () => {
    expect(gate([r('a', 1, 'pass'), r('a', 2, 'fail', 'critical'), r('a', 3, 'pass')])).toEqual({ decision: 'BLOCK', blocking: ['a'] });
  });
  test('each blocking question is listed once, sorted', () => {
    expect(gate([r('z', 1, 'fail', 'critical'), r('a', 1, 'fail', 'critical'), r('z', 2, 'fail', 'critical')]).blocking).toEqual(['a', 'z']);
  });
});
