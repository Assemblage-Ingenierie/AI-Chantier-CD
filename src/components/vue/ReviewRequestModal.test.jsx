// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ReviewRequestModal from './ReviewRequestModal.jsx';

describe('Faire relire (email)', () => {
  it('aperçu de l\'email : objet AICHANTIER - Relecture AXXX + lien vers la visite ; bouton inactif sans adresse', () => {
    localStorage.clear();
    const html = renderToStaticMarkup(<ReviewRequestModal projet={{ id: 'p1', nom: 'A743_TERRESTERRES' }} visiteId="v1" visiteLabel="DET n°5" onClose={() => {}}/>);
    expect(html).toContain('AICHANTIER - Relecture A743');
    expect(html).toContain('#relire=p1.v1');
    expect(html).toContain('Copier'); // lien à coller dans un chat
    expect(html).toContain('ou par email');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>.*Ouvrir dans Gmail/);
  });
});
