import { describe, it, expect } from 'vitest';
import { mergeDictation, collapseRepeats, capitalizeAfter } from './dictation.js';

describe('dictée : anti-doublons', () => {
  it('premier résultat : tel quel', () => {
    expect(mergeDictation('', 'fissure sur le linteau')).toBe('fissure sur le linteau');
  });

  it('Android cumulatif : la phrase entière revient → seule la suite est ajoutée', () => {
    expect(mergeDictation('fissure sur le linteau', 'fissure sur le linteau de la baie')).toBe('de la baie');
  });

  it('ponctuation / casse / apostrophe différentes → doublon quand même détecté', () => {
    expect(mergeDictation('Fissure sur le linteau.', 'fissure sur le linteau de l’entrée')).toBe('de l’entrée');
    expect(mergeDictation("il y a de l'eau", 'Il y a de l’eau, au sol')).toBe('au sol');
  });

  it('bout de phrase rejoué (redémarrage iOS) → ignoré', () => {
    expect(mergeDictation('le béton est éclaté en sous-face de la dalle au droit du poteau', 'en sous-face de la dalle')).toBe('');
  });

  it('chevauchement partiel : début répété retiré, suite gardée', () => {
    expect(mergeDictation('prévoir un ragréage', 'un ragréage puis une peinture')).toBe('puis une peinture');
  });

  it('jamais de vrai texte perdu : phrase nouvelle gardée entière', () => {
    expect(mergeDictation('fissure sur le linteau', 'traces d\'humidité en pied de mur')).toBe('traces d\'humidité en pied de mur');
    expect(mergeDictation('mur porteur', 'porteur')).toBe(''); // dernier mot redonné par le moteur
    expect(mergeDictation('mur porteur', 'mur')).toBe('mur'); // mot répété ailleurs : gardé
    expect(mergeDictation('mur porteur', 'en bon état')).toBe('en bon état');
  });

  it('répétition collée dans un même résultat → fusionnée', () => {
    expect(collapseRepeats('il y a une fissure il y a une fissure au droit du poteau')).toBe('il y a une fissure au droit du poteau');
    expect(collapseRepeats('très très bien')).toBe('très très bien'); // < 3 mots : on ne touche pas
  });

  it('majuscule en début de phrase', () => {
    expect(capitalizeAfter('', 'fissure')).toBe('Fissure');
    expect(capitalizeAfter('Le mur est sain.', 'fissure')).toBe('Fissure');
    expect(capitalizeAfter('Le mur est', 'fissuré')).toBe('fissuré');
  });
});
