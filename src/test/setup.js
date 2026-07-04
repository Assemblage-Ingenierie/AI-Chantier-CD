// Setup Vitest — happy-dom fournit localStorage, DOM, et globalThis.crypto (Node 20+).
// On garantit juste que localStorage est vide entre chaque test pour éviter les fuites d'état
// (storage.js et useProjets.js lisent/écrivent des clés persistées).
import { afterEach, beforeEach } from 'vitest';

beforeEach(() => {
  try { localStorage.clear(); } catch {}
});

afterEach(() => {
  try { localStorage.clear(); } catch {}
});
