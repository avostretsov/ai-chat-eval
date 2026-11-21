/**
 * Option A target: a tiny local store chat.
 *   GET  /            chat page
 *   GET  /policy      the published policy (the answer key's source)
 *   GET  /api/health  which provider/model/traps are live
 *   POST /api/chat    { messages: [{role, content}] } → { reply }
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';
import { config } from '../eval.config.js';
import { chat, type Message } from '../src/providers/index.js';
import { buildSystemPrompt, POLICY_PATH } from './bot-prompt.js';

const systemPrompt = buildSystemPrompt(config.traps);
const indexHTML = readFileSync(new URL('./public/index.html', import.meta.url), 'utf8');

function send(res: ServerResponse, status: number, type: string, body: string) {
  res.writeHead(status, { 'content-type': `${type}; charset=utf-8` });
  res.end(body);
}

function escapeHTML(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

/** Just enough Markdown for the policy page: #/## headings, - lists, **bold**, paragraphs. */
function renderPolicy(md: string): string {
  const inline = (s: string) => escapeHTML(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  const out: string[] = [];
  let inList = false;
  for (const line of md.split('\n')) {
    const item = line.match(/^- (.*)/);
    if (!item && inList) {
      out.push('</ul>');
      inList = false;
    }
    if (line.startsWith('## ')) {
      const title = line.slice(3);
      out.push(`<h2 id="${title.toLowerCase().replace(/\W+/g, '-')}">${inline(title)}</h2>`);
    } else if (line.startsWith('# ')) out.push(`<h1>${inline(line.slice(2))}</h1>`);
    else if (item) {
      if (!inList) out.push('<ul>');
      inList = true;
      out.push(`<li>${inline(item[1])}</li>`);
    } else if (line.trim()) out.push(`<p>${inline(line)}</p>`);
  }
  if (inList) out.push('</ul>');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Store Policy — Pinecrest Outfitters</title>
<style>body{font:16px/1.55 system-ui,sans-serif;max-width:720px;margin:2rem auto;padding:0 16px;color:#1f2a24}h2{margin-top:2rem;color:#2f5d46}a{color:#2f5d46}</style>
</head><body><p><a href="/">← Back to chat</a></p>${out.join('\n')}</body></html>`;
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

function isMessages(x: unknown): x is Message[] {
  return (
    Array.isArray(x) &&
    x.length > 0 &&
    x.length <= 20 &&
    x.every(
      (m) =>
        m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.length <= 2000,
    )
  );
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (req.method === 'GET' && url.pathname === '/') return send(res, 200, 'text/html', indexHTML);
    if (req.method === 'GET' && url.pathname === '/policy')
      return send(res, 200, 'text/html', renderPolicy(readFileSync(POLICY_PATH, 'utf8')));
    if (req.method === 'GET' && url.pathname === '/api/health')
      return send(res, 200, 'application/json', JSON.stringify({ ok: true, ...config.bot, traps: config.traps }));
    if (req.method === 'POST' && url.pathname === '/api/chat') {
      const body = JSON.parse(await readBody(req));
      if (!isMessages(body?.messages)) return send(res, 400, 'application/json', '{"error":"bad messages"}');
      const reply = await chat([{ role: 'system', content: systemPrompt }, ...body.messages], {
        provider: config.bot.provider,
        model: config.bot.model,
      });
      return send(res, 200, 'application/json', JSON.stringify({ reply: reply.trim() }));
    }
    send(res, 404, 'text/plain', 'Not found');
  } catch (err) {
    console.error(err);
    send(res, 502, 'application/json', JSON.stringify({ error: 'The assistant is unavailable right now.' }));
  }
});

server.listen(config.targets.local.port, () => {
  console.log(
    `Pinecrest chat on http://localhost:${config.targets.local.port} ` +
      `(provider=${config.bot.provider}, model=${config.bot.model}, traps=${config.traps ? 'on' : 'off'})`,
  );
});
