/**
 * The single place where every setting lives. Values come from .env (or the
 * shell) with $0 defaults. Test code reads this object and never hard-codes a
 * model, a judge or a target.
 */
import 'dotenv/config';

export type ProviderName = 'ollama' | 'claude' | 'openai';
export type JudgeName = 'off' | ProviderName;
export type TargetName = 'local' | 'shopify';

function pick<T extends string>(name: string, allowed: readonly T[], fallback: T): T {
  const raw = (process.env[name] ?? fallback).trim().toLowerCase();
  if (!(allowed as readonly string[]).includes(raw)) {
    throw new Error(`${name}="${raw}" is not one of: ${allowed.join(', ')}`);
  }
  return raw as T;
}

const PROVIDERS = ['ollama', 'claude', 'openai'] as const;

/** Sensible default model per provider, used when MODEL / JUDGE_MODEL is unset. */
export const DEFAULT_MODELS: Record<ProviderName, string> = {
  ollama: 'llama3.2:3b',
  claude: 'claude-haiku-5-5',
  openai: 'gpt-4o-mini',
};

const provider = pick('PROVIDER', PROVIDERS, 'ollama');
const judge = pick('JUDGE', ['off', ...PROVIDERS] as const, 'off');
const target = pick('TARGET', ['local', 'shopify'] as const, 'local');
const localPort = Number(process.env.LOCAL_PORT ?? 3000);

export const config = {
  /** The model behind the Option A chat page. */
  bot: {
    provider,
    model: process.env.MODEL || DEFAULT_MODELS[provider],
  },
  /** Check 4. "off" means checks 1–3 decide, and undecided replies become "Needs review". */
  judge: {
    provider: judge,
    model: judge === 'off' ? '' : process.env.JUDGE_MODEL || DEFAULT_MODELS[judge],
  },
  target,
  targets: {
    local: { baseURL: `http://localhost:${localPort}`, port: localPort },
    shopify: { baseURL: process.env.SHOPIFY_STORE_URL ?? '' },
  },
  /** Planted traps in the Option A bot's instructions. */
  traps: pick('TRAPS', ['on', 'off'] as const, 'on') === 'on',
  repeats: Math.max(1, Number(process.env.REPEATS ?? 3)),
  ollamaURL: process.env.OLLAMA_URL ?? 'http://localhost:11434',
} as const;

export function baseURL(): string {
  const url = config.targets[config.target].baseURL;
  if (!url) throw new Error(`TARGET=${config.target} needs its URL set in .env`);
  return url;
}
