import { useState, useEffect } from 'react';
import { getSupabase } from '../supabase.js';

const _cache = {};

// Retourne l'URL publique d'un asset du bucket Supabase "Branding".
// Fallback sur le fichier local /public/ si Supabase échoue.
export async function getBrandingUrl(filename) {
  if (_cache[filename]) return _cache[filename];
  try {
    const sb = await getSupabase();
    const { data } = sb.storage.from('Branding').getPublicUrl(filename);
    if (data?.publicUrl) {
      _cache[filename] = data.publicUrl;
      return data.publicUrl;
    }
  } catch {}
  return `/${filename}`;
}

// Hook React — commence par le fallback local, remplace par l'URL Supabase dès qu'elle est disponible.
export function useBrandingLogo(filename = 'logo-ai-rouge.svg') {
  const [url, setUrl] = useState(`/${filename}`);
  useEffect(() => {
    getBrandingUrl(filename).then(u => setUrl(u));
  }, [filename]);
  return url;
}
