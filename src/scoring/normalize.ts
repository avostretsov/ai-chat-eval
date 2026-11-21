/**
 * Text normalization for fact matching. The same function runs on the reply
 * AND on every rule phrase, so "$50.00", "50 dollars" and "fifty dollars"
 * all match the rule "$50", and "5–10" matches "5-10".
 */

const ONES: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
  seventeen: 17, eighteen: 18, nineteen: 19,
};
const TENS: Record<string, number> = {
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};
const UNIT_WORDS = Object.keys(ONES).filter((w) => ONES[w] < 10 && ONES[w] > 0).join('|');

export function normalize(input: string): string {
  let s = input.toLowerCase();

  // Typography: curly quotes, dashes, odd spaces.
  s = s
    .replace(/[‘’‛′]/g, "'")
    .replace(/[“”‟″]/g, '"')
    .replace(/[‐-―−]/g, '-')
    .replace(/[   ]/g, ' ');

  // Number words → digits. Tens first so "twenty-five" → 25, then the rest.
  s = s.replace(new RegExp(`\\b(${Object.keys(TENS).join('|')})(?:[- ](${UNIT_WORDS}))?\\b`, 'g'), (_, t, u) =>
    String(TENS[t] + (u ? ONES[u] : 0)),
  );
  s = s.replace(new RegExp(`\\b(${Object.keys(ONES).join('|')})\\b`, 'g'), (w) => String(ONES[w]));

  // Thousands separators: 3,000 → 3000 (only real groups of three digits).
  s = s.replace(/(\d),(?=\d{3}\b)/g, '$1');

  // Money: "$ 50.00" → "$50"; "50 dollars" / "50 usd" → "$50". Cents other than .00 stay.
  s = s.replace(/\$\s+(?=\d)/g, '$');
  s = s.replace(/(\$\d+)\.00\b/g, '$1');
  s = s.replace(/(?<![\d$.])(\d+(?:\.\d+)?)\s*(?:us\s+)?(?:dollars?|usd|bucks)\b/g, (_, n) =>
    '$' + n.replace(/\.00$/, ''),
  );

  // Ranges: "5 - 10" / "5 to 10" stay distinct, but tidy "5 - 10" → "5-10".
  s = s.replace(/(\d)\s*-\s*(\d)/g, '$1-$2');

  return s.replace(/\s+/g, ' ').trim();
}

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Does the (already normalized) text contain the phrase as whole words?
 * "us" does not match "customers"; "$50" does not match "$500" or "$50.50".
 */
export function containsPhrase(normalizedText: string, phrase: string): boolean {
  const p = normalize(phrase);
  if (!p) return false;
  const re = new RegExp(`(?<![a-z0-9$])${escapeRegExp(p)}(?![a-z0-9]|\\.\\d)`);
  return re.test(normalizedText);
}
