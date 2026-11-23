// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ArchivePreview from './ArchivePreview.jsx';

const projet = {
  id: 'p1', nom: 'Groupe scolaire', statut: 'archive',
  visites: [
    { id: 'v1', label: 'Visite 1', localisations: [{ id: 'l1', nom: 'RDC', items: [{ id: 'i1', titre: 'Ancien', commentaire: 'Texte V1' }] }] },
    { id: 'v2', label: 'Visite 2', conclusion: 'Bilan final', localisations: [
      { id: 'l2', nom: 'R+1', items: [{ id: 'i2', titre: 'Fissure poutre', commentaire: '<p>Reprise <b>résine</b></p>', photos: [{}, {}] }] },
      { id: 'l3', nom: 'Vide', items: [] },
      { id: 'l4', nom: 'Toiture', items: [], planId: 'pl1', planAnnotations: { paths: [] } },
    ] },
  ],
};

describe('ArchivePreview (lecture seule)', () => {
  it('affiche la dernière visite par défaut, texte + conclusion, sans zone vide', () => {
    const html = renderToStaticMarkup(<ArchivePreview projet={projet} onClose={() => {}}/>);
    expect(html).toContain('Fissure poutre');
    expect(html).toContain('résine');
    expect(html).toContain('Bilan final');
    expect(html).not.toContain('Texte V1');
    expect(html).not.toContain('>Vide<');
    expect(html).toContain('Toiture'); // zone sans observation mais avec plan : affichée
  });
  it('projet sans visite : message vide, pas de crash', () => {
    const html = renderToStaticMarkup(<ArchivePreview projet={{ id: 'p', nom: 'X', visites: [] }} onClose={() => {}}/>);
    expect(html).toContain('Aucune observation');
  });
});

describe('ArchivePreview — choix de la visite', () => {
  it('ouvre sur la visite la plus RÉCENTE (date), menu déroulant, plus de bouton Copier', () => {
    const p = { id: 'p', nom: 'X', visites: [
      { id: 'a', label: 'Visite récente', dateVisite: '2026-10-14', localisations: [{ id: 'l', nom: 'Z', items: [{ id: 'i', titre: 'Texte récent' }] }] },
      { id: 'b', label: 'Visite ancienne', dateVisite: '2026-01-02', localisations: [{ id: 'l2', nom: 'Z', items: [{ id: 'i2', titre: 'Texte ancien' }] }] },
    ] };
    const html = renderToStaticMarkup(<ArchivePreview projet={p} onClose={() => {}}/>);
    expect(html).toContain('Texte récent');
    expect(html).not.toContain('Texte ancien');
    expect(html).toContain('<select');
    expect(html.indexOf('Visite récente')).toBeLessThan(html.indexOf('Visite ancienne'));
    expect(html).not.toContain('Copier');
  });
});
