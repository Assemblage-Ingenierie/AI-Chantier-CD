// Proxy IA : un moteur qui ne répond pas ne doit plus faire échouer la requête (« Timeout IA »).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import handler from '../../api/ai-proxy.js';

const hang = (signal) => new Promise((_, rej) => signal?.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
const ok = (json) => Promise.resolve({ ok: true, status: 200, json: async () => json });
const MISTRAL_OK = { model: 'mistral-small-latest', choices: [{ message: { content: 'réponse Mistral' }, finish_reason: 'stop' }] };

function call(body) {
  const res = { code: 0, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
  const req = { method: 'POST', headers: { authorization: 'Bearer t', 'x-forwarded-for': `ip${Math.random()}` }, body };
  return { done: handler(req, res), res };
}

beforeEach(() => {
  vi.useFakeTimers();
  process.env.GEMINI_API_KEY = 'g'; process.env.MISTRAL_API_KEY = 'm';
  delete process.env.ANTHROPIC_API_KEY; delete process.env.SUPABASE_URL;
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('proxy IA — budget de temps', () => {
  it('Gemini bloqué → bascule sur Mistral en ~30 s (avant que l\'app n\'abandonne à 55 s)', async () => {
    const calls = [];
    vi.stubGlobal('fetch', vi.fn((url, opts) => {
      calls.push(String(url));
      return String(url).includes('mistral') ? ok(MISTRAL_OK) : hang(opts?.signal);
    }));
    const { done, res } = call({ provider: 'gemini', model: 'gemini-flash-latest', max_tokens: 500, messages: [{ role: 'user', content: 'x' }] });
    await vi.advanceTimersByTimeAsync(31000);
    await done;
    expect(res.code).toBe(200);
    expect(res.body.content[0].text).toBe('réponse Mistral');
    expect(calls.filter(u => u.includes('generativelanguage')).length).toBe(1); // un seul essai Gemini, pas 4 à la suite
  });

  it('tous les moteurs bloqués → réponse d\'erreur AVANT 55 s (jamais de coupure côté app)', async () => {
    vi.stubGlobal('fetch', vi.fn((url, opts) => hang(opts?.signal)));
    const t0 = Date.now();
    const { done, res } = call({ provider: 'gemini', max_tokens: 500, messages: [{ role: 'user', content: 'x' }] });
    await vi.advanceTimersByTimeAsync(55000);
    await done;
    expect(res.code).toBeGreaterThanOrEqual(400);
    expect(res.body.error).toBeTruthy();
    expect(Date.now() - t0).toBeLessThanOrEqual(55000);
  });

  it('un seul moteur configuré : il dispose de tout le budget (réponse lente mais valide acceptée)', async () => {
    delete process.env.MISTRAL_API_KEY;
    vi.stubGlobal('fetch', vi.fn((url, opts) => new Promise((resolve, rej) => {
      const t = setTimeout(() => resolve({ ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: 'lent mais ok' }] }, finishReason: 'STOP' }] }) }), 40000);
      opts?.signal?.addEventListener('abort', () => { clearTimeout(t); rej(Object.assign(new Error('aborted'), { name: 'AbortError' })); });
    })));
    const { done, res } = call({ provider: 'gemini', max_tokens: 500, messages: [{ role: 'user', content: 'x' }] });
    await vi.advanceTimersByTimeAsync(41000);
    await done;
    expect(res.code).toBe(200);
    expect(res.body.content[0].text).toBe('lent mais ok');
  });
});
