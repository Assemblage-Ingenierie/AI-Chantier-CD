// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import RewritePanel from './RewritePanel.jsx';

const noop = () => {};
describe('RewritePanel — orthographe seule', () => {
  it('seul le mot corrigé ressort (ancien barré), le reste de la phrase reste neutre (retour 24/11)', () => {
    const segments = [{ type: 'fix', id: 0, kind: 'ortho', active: true, del: "Diagnostic de l'état géneral du bâtiment :", add: "Diagnostic de l'état général du bâtiment :" }];
    const html = renderToStaticMarkup(<RewritePanel segments={segments} onToggle={noop} onAll={noop} onApply={noop} onClose={noop} />);
    expect(html).toMatch(/line-through[^>]*>géneral</);
    expect(html).toMatch(/font-weight:700[^>]*>général</);
    expect(html).not.toMatch(/>Diagnostic de l&#x27;état général du bâtiment :</); // plus de phrase entière surlignée
    const text = html.replace(/<[^>]+>/g, '');
    expect(text).toContain("Diagnostic de l&#x27;état géneralgénéral du bâtiment :");
  });
});
