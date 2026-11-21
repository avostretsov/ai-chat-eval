/**
 * A stand-in for a Shopify storefront with the Zopi widget, served through
 * page.route() so nothing leaves the machine. Its markup copies what the live
 * widget had on 2026-11-21 (open shadow DOM, ids, classes, aria labels), and it
 * behaves the awkward ways the real one does: a password page, a typing bubble,
 * replies that stream in with pauses, product cards inside the reply.
 */
import type { Page } from '@playwright/test';

export interface MockStore {
  /** Clicking the launcher sends a question by itself, like the "AI agent pill" on product pages. */
  autoSend: boolean;
}

export const MOCK_ORIGIN = 'https://store.mock';

const passwordPage = (error = '') => `<!doctype html><html><body>
<form method="post" action="/password"><label>Enter store password <input type="password" name="password"></label>
<button type="submit">Enter</button>${error ? `<p class="error">${error}</p>` : ''}</form></body></html>`;

function storePage(autoSend: boolean) {
  return `<!doctype html><html><head><title>Mock store</title></head><body>
<h1>Mock store</h1><zopi-chat-widget></zopi-chat-widget>
<script>
const AUTO_SEND = ${autoSend};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
customElements.define('zopi-chat-widget', class extends HTMLElement {
  constructor() {
    super();
    const r = this.attachShadow({ mode: 'open' });
    r.innerHTML = \`
      <button id="zopi-launcher" aria-expanded="false" aria-label="Open chat">Chat with us</button>
      <div id="zopi-panel" hidden>
        <div id="zopi-messages" aria-live="polite">
          <div class="zopi-msg-row assistant ai zopi-welcome"><span class="zopi-avatar">A</span>
            <div class="zopi-msg-col"><span class="zopi-name">AI</span><div class="zopi-msg assistant ai"><p>Hi! How can I help you?</p></div></div></div>
        </div>
        <div id="zopi-input-area"><textarea id="zopi-input" aria-label="Message input" placeholder="Compose your message…"></textarea>
          <button aria-label="Send message">➤</button></div>
      </div>\`;
    this.r = r;
    r.querySelector('#zopi-launcher').addEventListener('click', () => this.toggle());
    r.querySelector('button[aria-label="Send message"]').addEventListener('click', () => this.send(r.querySelector('#zopi-input').value));
  }
  toggle() {
    const l = this.r.querySelector('#zopi-launcher');
    const open = l.getAttribute('aria-expanded') !== 'true';
    l.setAttribute('aria-expanded', String(open));
    l.setAttribute('aria-label', open ? 'Close chat' : 'Open chat');
    this.r.querySelector('#zopi-panel').hidden = !open;
    if (open && AUTO_SEND && !this.sent) { this.sent = true; this.send('Tell me about this product'); }
  }
  async send(text) {
    const m = this.r.querySelector('#zopi-messages');
    this.r.querySelector('#zopi-input').value = '';
    m.insertAdjacentHTML('beforeend', '<div class="zopi-msg-wrap user"><div class="zopi-msg user"><div class="zopi-msg-text"></div></div><time>10:18 AM</time></div>');
    m.lastElementChild.querySelector('.zopi-msg-text').textContent = text;
    window.__asked.push(text);
    await sleep(300);
    m.insertAdjacentHTML('beforeend', '<div class="zopi-typing-bubble"><span class="zopi-typing-dots">…</span></div>');
    await sleep(800);
    m.querySelector('.zopi-typing-bubble').remove();
    m.insertAdjacentHTML('beforeend', '<div class="zopi-msg-row assistant ai"><span class="zopi-avatar">A</span><div class="zopi-msg-col"><span class="zopi-name">AI</span><div class="zopi-msg assistant ai"><p></p></div><time class="zopi-msg-time">10:19 AM</time></div></div>');
    const bubble = m.lastElementChild.querySelector('.zopi-msg.assistant');
    const p = bubble.querySelector('p');
    const answer = /shipping/i.test(text)
      ? 'We offer free standard shipping on US orders over $50. || Orders under $50 pay $6.95.'
      : /backpack/i.test(text) ? 'The Summit 45 backpack holds 45 liters.' : 'Mock answer to: ' + text;
    for (const part of answer.split(' ')) {
      if (part === '||') { await sleep(1000); continue; } // a pause mid-reply, shorter than the settle time
      p.textContent += (p.textContent ? ' ' : '') + part;
      await sleep(60);
    }
    if (/backpack/i.test(text)) bubble.insertAdjacentHTML('beforeend',
      '<div class="zopi-product-card"><span>Summit 45 backpack</span><span>$179.00</span><button aria-label="Add to cart">+</button></div>');
  }
});
window.__asked = [];
</script></body></html>`;
}

// Playwright does not follow a 302 from a mocked response, so the mock
// redirects the way a browser would after it: by loading the new URL.
const goTo = (path: string) => `<!doctype html><script>location.replace(${JSON.stringify(path)})</script>`;

/** Serve the mock store for MOCK_ORIGIN on this page. `password` is what the password page accepts. */
export async function serveMockStore(page: Page, password: string, store: MockStore) {
  await page.route((u) => u.origin === MOCK_ORIGIN, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const unlocked = (await req.headerValue('cookie'))?.includes('storefront_digest=ok');
    if (url.pathname === '/password' && req.method() === 'POST') {
      const sent = new URLSearchParams(req.postData() ?? '').get('password');
      if (sent === password)
        return route.fulfill({ contentType: 'text/html', headers: { 'set-cookie': 'storefront_digest=ok; Path=/' }, body: goTo('/') });
      return route.fulfill({ contentType: 'text/html', body: passwordPage('Password incorrect') });
    }
    if (url.pathname === '/password') return route.fulfill({ contentType: 'text/html', body: passwordPage() });
    if (!unlocked) return route.fulfill({ contentType: 'text/html', body: goTo('/password') });
    return route.fulfill({ contentType: 'text/html', body: storePage(store.autoSend) });
  });
}

/** What the mock bot was asked, read from the page. */
export const askedOn = (page: Page) => page.evaluate(() => (window as unknown as { __asked: string[] }).__asked);
