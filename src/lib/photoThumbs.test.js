import { describe, it, expect, vi, beforeEach } from 'vitest';

// Faux client Supabase : createSignedUrl avec transform → URL /render/image/sign/.
const calls = [];
const sb = { fail: false };
vi.mock('../supabase.js', () => ({
  getSupabase: async () => ({
    storage: {
      from: () => ({
        createSignedUrl: async (path, ttl, opts) => {
          calls.push({ path, ttl, opts });
          if (sb.fail) return { data: null, error: { message: 'transformations disabled' } };
          return { data: { signedUrl: `https://x.supabase.co/storage/v1/render/image/sign/photos/${path}?token=T${calls.length}` }, error: null };
        },
      }),
    },
  }),
}));

const T = await import('./photoThumbs.js');
const SIGNED = 'https://x.supabase.co/storage/v1/object/sign/photos/proj_ab12/item1/ph%201.webp?token=abc';

beforeEach(() => { calls.length = 0; sb.fail = false; T._resetThumbsForTests(); });

describe('vignettes allégées des photos', () => {
  it('seules les URL signées du bucket photos sont éligibles', () => {
    expect(T.photoPathFromUrl(SIGNED)).toBe('proj_ab12/item1/ph 1.webp');
    expect(T.thumbKey('data:image/webp;base64,AAAA', 640)).toBeNull();
    expect(T.thumbKey('blob:https://app/123', 640)).toBeNull();
    expect(T.thumbKey('https://x.supabase.co/storage/v1/object/public/Branding/logo.png', 640)).toBeNull();
    expect(T.thumbKey(null, 640)).toBeNull();
  });

  it('signe une vignette redimensionnée, puis la sert depuis le cache sans re-signer', async () => {
    const u = await T.getThumbUrl(SIGNED, 640);
    expect(u).toContain('/render/image/sign/');
    expect(calls[0].opts.transform.width).toBe(640);
    expect(calls[0].path).toBe('proj_ab12/item1/ph 1.webp');
    const again = await T.getThumbUrl(SIGNED, 640);
    expect(again).toBe(u);
    expect(calls).toHaveLength(1);
    expect(T.peekThumb(T.thumbKey(SIGNED, 640))).toBe(u);
  });

  it('couvertures (allowPath) : un simple chemin est signé directement, même clé que l\'URL signée', async () => {
    const path = 'proj_ab12/cover/c123.webp';
    expect(T.thumbKey(path, 640)).toBeNull(); // hors couvertures : inchangé
    expect(T.thumbKey(path, 640, true)).toBe(`${path}@w640`);
    expect(T.thumbKey('data:image/png;base64,AA', 640, true)).toBeNull();
    expect(T.thumbKey('/assets/x.png', 640, true)).toBeNull();
    const u = await T.getThumbUrl(path, 640, true);
    expect(u).toContain('/render/image/sign/photos/proj_ab12/cover/c123.webp');
    expect(calls[0].path).toBe(path);
    const signed = 'https://x.supabase.co/storage/v1/object/sign/photos/proj_ab12/cover/c123.webp?token=z';
    expect(T.thumbKey(signed, 640)).toBe(T.thumbKey(path, 640, true)); // pas de re-signature à l'arrivée de l'URL
  });

  it('demandes simultanées pour la même photo → une seule signature', async () => {
    const [a, b] = await Promise.all([T.getThumbUrl(SIGNED, 320), T.getThumbUrl(SIGNED, 320)]);
    expect(a).toBe(b);
    expect(calls).toHaveLength(1);
  });

  it('échec de signature → null (l\'appelant affiche l\'original)', async () => {
    sb.fail = true;
    expect(await T.getThumbUrl(SIGNED, 640)).toBeNull();
  });

  it('transformations indisponibles : coupées pour la session après plusieurs échecs d\'affilée', async () => {
    sb.fail = true;
    for (let i = 0; i < 4; i++) await T.getThumbUrl(SIGNED.replace('ph%201', `p${i}`), 640);
    expect(T.thumbsDisabled()).toBe(true);
    sb.fail = false;
    expect(await T.getThumbUrl(SIGNED.replace('ph%201', 'autre'), 640)).toBeNull();
  });

  it('vignette qui ne se charge pas → oubliée, plus jamais proposée cette session', async () => {
    await T.getThumbUrl(SIGNED, 640);
    const key = T.thumbKey(SIGNED, 640);
    T.reportThumbError(key);
    expect(T.peekThumb(key)).toBeNull();
    expect(await T.getThumbUrl(SIGNED, 640)).toBeNull();
  });

  it('un succès remet le compteur d\'échecs à zéro', async () => {
    sb.fail = true;
    for (let i = 0; i < 3; i++) await T.getThumbUrl(SIGNED.replace('ph%201', `q${i}`), 640);
    T.reportThumbOk();
    await T.getThumbUrl(SIGNED.replace('ph%201', 'q9'), 640);
    expect(T.thumbsDisabled()).toBe(false);
  });
});
