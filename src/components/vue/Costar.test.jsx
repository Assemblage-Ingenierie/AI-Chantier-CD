// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

vi.mock('../../lib/aiProxy.js', () => ({ callAIProxy: vi.fn(() => Promise.reject(new Error('pas d\'IA en test'))), getAIProvider: () => 'claude' }));
import { callAIProxy } from '../../lib/aiProxy.js';
import Costar from './Costar.jsx';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const projet = { id: 'p1', dateVisite: '2026-11-20', visiteNom: 'V1', localisations: [{ id: 'l1', nom: 'RDC', items: [{ id: 'a', titre: 'Porche', commentaire: 'Revêtement à déposer.' }] }] };

describe('Costar — dernier avis gardé, relecture seulement sur demande (retour Thomas 24/11)', () => {
  beforeEach(() => { localStorage.clear(); window.innerWidth = 1400; callAIProxy.mockClear(); });
  it('remontage : clic sur Costar → l\'avis précédent s\'affiche, SANS relecture ; « ↻ Relire » relance', async () => {
    localStorage.setItem('chantierai_costar_last_v1', JSON.stringify({ 'p1|2026-11-20|V1': { review: { note: 7, pertes: [], bien: ['Obs 1 : signalement net'], manques: [], ameliorer: [], coince: [], verdict: 'Belle ouvrage' }, key: 'ancienne', t: 1 } }));
    const div = document.createElement('div'); document.body.appendChild(div);
    const root = createRoot(div);
    await act(async () => { root.render(<Costar projet={projet} fixed/>); });
    const avatar = [...div.querySelectorAll('button')].pop();
    await act(async () => { avatar.click(); });
    expect(div.textContent).toContain('7/10');
    expect(div.textContent).toContain('signalement net');
    expect(callAIProxy).not.toHaveBeenCalled();
    const relire = [...div.querySelectorAll('button')].find(b => b.textContent.includes('↻ Relire'));
    expect(relire).toBeTruthy();
    await act(async () => { relire.click(); });
    expect(callAIProxy).toHaveBeenCalledTimes(1);
    const msg = callAIProxy.mock.calls[0][0].messages[0].content;
    expect(msg).not.toContain('Ton avis précédent'); // pas d'empreinte enregistrée → pas d'ancrage
    await act(async () => { root.unmount(); });
  });
  it('observation modifiée après l\'avis : remarque barrée « ✓ corrigé » et note estimée, sans relance', async () => {
    const { obsFingerprints } = await import('../../lib/costar.js');
    localStorage.setItem('chantierai_costar_last_v1', JSON.stringify({ 'p1|2026-11-20|V1': {
      review: { note: 6, pertes: [{ type: 'action', points: 1, raison: 'Obs 1 : aucune suite', citation: 'Revêtement' }], bien: [], manques: [], ameliorer: ['Obs 1 : tu pourrais préciser'], coince: [], verdict: 'Ok' },
      key: 'k', t: 1, fp: obsFingerprints(projet), idx: { 1: 'a' } } }));
    const div = document.createElement('div'); document.body.appendChild(div);
    const root = createRoot(div);
    await act(async () => { root.render(<Costar projet={projet} fixed/>); });
    // Bulle rouverte d'elle-même si elle était ouverte avant (remontage) ; sinon clic sur Costar.
    if (!div.textContent.includes('/10')) await act(async () => { [...div.querySelectorAll('button')].pop().click(); });
    expect(div.textContent).toContain('6/10');
    expect(div.textContent).not.toContain('✓ corrigé');
    const modifie = { ...projet, localisations: [{ ...projet.localisations[0], items: [{ id: 'a', titre: 'Porche', commentaire: 'Revêtement à déposer : prévoir la dépose.' }] }] };
    await act(async () => { root.render(<Costar projet={modifie} fixed/>); });
    expect(div.textContent).toContain('✓ corrigé');
    expect(div.textContent).toContain('→ ~7/10');
    expect(callAIProxy).not.toHaveBeenCalled();
    await act(async () => { root.unmount(); });
  });
});
