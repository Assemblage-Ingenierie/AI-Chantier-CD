import { describe, it, expect } from 'vitest';
import { cleanPastedHtml } from '../components/ui/RichTextArea.jsx';

// Retour Thomas 20/11 : « au copier-coller, ça ajoute plein de sauts de ligne ».
describe('Collage dans l\'éditeur d\'observation', () => {
  it('les retours à la ligne du code source ne deviennent PAS des lignes', () => {
    const html = '<p>Fissure en sous-face\n   de la poutre,\r\n  côté cour.</p>\n\n<p>Purger les\n bétons.</p>';
    expect(cleanPastedHtml(html)).toBe('<div>Fissure en sous-face de la poutre, côté cour.</div><div>Purger les bétons.</div>');
  });
  it('Word : paragraphes vides en série → une seule ligne vide, pas au début ni à la fin', () => {
    const html = '<p class=MsoNormal>&nbsp;</p><p class=MsoNormal>A</p><p>&nbsp;</p><p>&nbsp;</p><p>&nbsp;</p><p>B</p><p>&nbsp;</p>';
    expect(cleanPastedHtml(html)).toBe('<div>A</div><div><br></div><div>B</div>');
  });
  it('Google Docs : faux gras englobant ignoré, <br> entre paragraphes retirés', () => {
    const html = '<b style="font-weight:normal;" id="docs-internal-guid-1"><p dir="ltr"><span>Un</span></p><br><p dir="ltr"><span style="font-weight:700">Deux</span></p></b>';
    expect(cleanPastedHtml(html)).toBe('<div>Un</div><div>Deux</div>');
  });
  it('gras, italique, souligné, puces conservés ; une ligne vide voulue reste', () => {
    expect(cleanPastedHtml('<div><b>Gras</b> et <i>ital</i></div><div><br></div><ul><li>x</li></ul>'))
      .toBe('<div><strong>Gras</strong> et <em>ital</em></div><div><br></div><ul><li>x</li></ul>');
  });
  it('texte « a < b » reste du texte ; styles CSS jamais collés', () => {
    expect(cleanPastedHtml('<style>p{color:red}</style><p>section &lt; 5mm</p>')).toBe('<div>section &lt; 5mm</div>');
  });
});
