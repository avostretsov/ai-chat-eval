/**
 * Provider adapter: one function, chat(), whatever model sits behind it.
 * Both the Option A bot and the LLM judge use this, so switching from Ollama to
 * a paid API is a setting in .env, never a code change.
 */
import { config, type ProviderName } from '../../eval.config.js';

export type Role = 'system' | 'user' | 'assistant';
export interface Message {
  role: Role;
  content: string;
}
export interface ChatOptions {
  provider: ProviderName;
  model: string;
  temperature?: number;
  /** Ask the model for a JSON object (used by the judge). */
  json?: boolean;
}

export async function chat(messages: Message[], opts: ChatOptions): Promise<string> {
  switch (opts.provider) {
    case 'ollama':
      return ollama(messages, opts);
    case 'claude':
      return claude(messages, opts);
    case 'openai':
      return openai(messages, opts);
  }
}

async function postJSON(url: string, body: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${url} → ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json() as Promise<any>;
}

async function ollama(messages: Message[], opts: ChatOptions): Promise<string> {
  const data = await postJSON(`${config.ollamaURL}/api/chat`, {
    model: opts.model,
    messages,
    stream: false,
    ...(opts.json ? { format: 'json' } : {}),
    options: { temperature: opts.temperature ?? 0.7 },
  });
  return data.message?.content ?? '';
}

function requireKey(name: string): string {
  const key = process.env[name];
  if (!key) throw new Error(`${name} is not set. Add it to .env to use this provider.`);
  return key;
}

async function claude(messages: Message[], opts: ChatOptions): Promise<string> {
  const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
  const data = await postJSON(
    'https://api.anthropic.com/v1/messages',
    {
      model: opts.model,
      max_tokens: 1024,
      temperature: opts.temperature ?? 0.7,
      ...(system ? { system } : {}),
      messages: messages.filter((m) => m.role !== 'system'),
    },
    { 'x-api-key': requireKey('ANTHROPIC_API_KEY'), 'anthropic-version': '2023-06-01' },
  );
  return (data.content ?? []).map((b: any) => b.text ?? '').join('');
}

async function openai(messages: Message[], opts: ChatOptions): Promise<string> {
  const data = await postJSON(
    'https://api.openai.com/v1/chat/completions',
    {
      model: opts.model,
      messages,
      temperature: opts.temperature ?? 0.7,
      ...(opts.json ? { response_format: { type: 'json_object' } } : {}),
    },
    { authorization: `Bearer ${requireKey('OPENAI_API_KEY')}` },
  );
  return data.choices?.[0]?.message?.content ?? '';
}
