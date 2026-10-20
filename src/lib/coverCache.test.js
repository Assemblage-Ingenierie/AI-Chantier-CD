import { describe, it, expect } from 'vitest';
import { coverCacheKey, isStoragePath } from './coverCache.js';

describe('coverCacheKey — même clé quelle que soit la forme de la couverture', () => {
  const path = 'rue_de_clery_1a2b3c4d/cover/1a2b3c4d-x/c9f8e7.webp';
  it('URL signée, URL publique et simple chemin → même clé', () => {
    expect(coverCacheKey(`https://abc.supabase.co/storage/v1/object/sign/photos/${path}?token=xyz`)).toBe(path);
    expect(coverCacheKey(`https://abc.supabase.co/storage/v1/object/public/photos/${path}`)).toBe(path);
    expect(coverCacheKey(path)).toBe(path);
  });
  it('chemin encodé dans l\'URL → décodé', () => {
    expect(coverCacheKey('https://abc.supabase.co/storage/v1/object/sign/photos/caf%C3%A9_1/cover/a.webp?token=1')).toBe('café_1/cover/a.webp');
  });
  it('data:, blob:, autres URL, vide → pas de clé', () => {
    expect(coverCacheKey('data:image/jpeg;base64,AAAA')).toBeNull();
    expect(coverCacheKey('blob:https://app/123')).toBeNull();
    expect(coverCacheKey('https://exemple.com/image.jpg')).toBeNull();
    expect(coverCacheKey(null)).toBeNull();
    expect(coverCacheKey('')).toBeNull();
  });
  it('isStoragePath : seulement les chemins nus', () => {
    expect(isStoragePath(path)).toBe(true);
    expect(isStoragePath('https://x/y.jpg')).toBe(false);
    expect(isStoragePath('data:image/png;base64,A')).toBe(false);
    expect(isStoragePath(null)).toBe(false);
  });
});
