import { describe, it, expect } from 'vitest';
import { affaireCode, reviewLink, parseReviewHash, buildReviewMail, mailtoUrl, gmailUrl } from './reviewRequest.js';

describe('Demande de relecture par email (demande Thomas 24/11)', () => {
  it('code affaire tiré du nom', () => {
    expect(affaireCode('A743_TERRESTERRES_65RVOLTAIRE')).toBe('A743');
    expect(affaireCode('2026_A735_OSSANT')).toBe('A735');
    expect(affaireCode('Groupe scolaire')).toBe('Groupe scolaire');
  });
  it('lien aller-retour', () => {
    const l = reviewLink('https://aichantier.assemblage.net/', 'p-1', 'v-2');
    expect(l).toBe('https://aichantier.assemblage.net/#relire=p-1.v-2');
    expect(parseReviewHash(l.slice(l.indexOf('#')))).toEqual({ projetId: 'p-1', visiteId: 'v-2' });
    expect(parseReviewHash('#navdebug')).toBeNull();
  });
  it('objet « AICHANTIER - Relecture AXXX », point d\'attention facultatif', () => {
    const m = buildReviewMail({ nom: 'A743_TERRESTERRES', visiteLabel: 'DET n°5', link: 'L', note: 'la poutre du porche', from: 'Thomas' });
    expect(m.subject).toBe('AICHANTIER - Relecture A743');
    expect(m.body).toContain('Point d\'attention : la poutre du porche');
    expect(m.body).toContain('Lien vers le rapport : L');
    expect(buildReviewMail({ nom: 'A743', link: 'L' }).body).not.toContain('Point d\'attention');
  });
  it('mailto encodé', () => {
    const u = mailtoUrl('pierre@x.fr', { subject: 'A & B', body: 'l1\nl2' });
    expect(u).toBe('mailto:pierre@x.fr?subject=A%20%26%20B&body=l1%0Al2');
  });
  it('nouveau message Gmail prérempli', () => {
    const u = new URL(gmailUrl('pierre@x.fr', { subject: 'AICHANTIER - Relecture A743', body: 'l1\nl2' }));
    expect(u.origin + u.pathname).toBe('https://mail.google.com/mail/');
    expect(u.searchParams.get('view')).toBe('cm');
    expect(u.searchParams.get('to')).toBe('pierre@x.fr');
    expect(u.searchParams.get('su')).toBe('AICHANTIER - Relecture A743');
    expect(u.searchParams.get('body')).toBe('l1\nl2');
  });
});
