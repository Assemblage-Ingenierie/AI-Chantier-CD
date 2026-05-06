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

// Hook React — null jusqu'à ce que l'URL Supabase soit résolue (évite le 404 sur fallback local)
export function useBrandingLogo(filename = 'logo/logo_Ai_rouge.svg') {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    getBrandingUrl(filename).then(u => setUrl(u));
  }, [filename]);
  return url;
}
