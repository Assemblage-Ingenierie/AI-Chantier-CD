import React, { useState, useRef } from 'react';
import { DA } from '../../lib/constants.js';
import { Ic } from '../ui/Icons.jsx';
import { classifyPdfImport } from '../../lib/contacts.js';
import { getPdfText } from '../../lib/pdfUtils.js';
import { callAIProxy } from '../../lib/aiProxy.js';

// Importe des intervenants depuis un PDF (CR d'archi) OU une capture d'écran / photo, via l'IA,
// avec dédup floue et écran de revue. Réutilisable : le carnet (ajout au carnet) ET la page de
// garde (ajout aux participants). L'appelant reçoit la liste VALIDÉE via onImported(contacts).
//
// Props :
//   existingContacts : contacts déjà connus (pour la dédup)
//   onImported(list) : appelé avec les contacts cochés à la validation (async)
//   label            : libellé du bouton (défaut « PDF / Photo »)

function fileToDataUrl(file) {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); });
}
// Image → bloc vision base64 (redimensionnée pour rester légère et rapide).
function imageFileToBlock(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const im = new window.Image();
    im.onload = () => {
      try {
        const scale = Math.min(1, 1600 / Math.max(im.naturalWidth, im.naturalHeight));
        const W = Math.max(1, Math.round(im.naturalWidth * scale));
        const H = Math.max(1, Math.round(im.naturalHeight * scale));
        const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
        const ctx = cv.getContext('2d');
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
        ctx.drawImage(im, 0, 0, W, H);
        const b64 = cv.toDataURL('image/jpeg', 0.85).split(',')[1];
        URL.revokeObjectURL(url);
        resolve({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: b64 } });
      } catch (e) { URL.revokeObjectURL(url); reject(e); }
    };
    im.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
    im.src = url;
  });
}

const EXTRACT_INSTRUCTIONS = `Extrais TOUS les intervenants (personnes) cités : nom complet, poste/rôle, entreprise/société, e-mail, téléphone. Ignore ce qui n'est pas une personne. Champ absent = chaîne vide.\nRéponds UNIQUEMENT avec un JSON valide, sans texte autour :\n{"contacts":[{"nom":"","poste":"","entreprise":"","email":"","tel":""}]}`;

export default function ContactsImporter({ existingContacts = [], onImported, label = 'PDF / Photo' }) {
  const fileRef = useRef();
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [result, setResult] = useState(null); // { rows:[{status,sel,contact,match}] }
  const [saving, setSaving] = useState(false);

  const analyze = async (file) => {
    if (!file) return;
    setErr(''); setResult(null);
    const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
    const isImg = file.type.startsWith('image/');
    if (!isPdf && !isImg) { setErr('Format non reconnu (PDF ou image).'); return; }
    try {
      let messages;
      if (isPdf) {
        setBusy('Lecture du PDF…');
        const text = await getPdfText(await fileToDataUrl(file));
        if (!text || text.length < 20) { setErr('PDF illisible ou sans texte (scan image ? passe par une capture d’écran).'); setBusy(''); return; }
        messages = [{ role: 'user', content: `${EXTRACT_INSTRUCTIONS}\n\nTEXTE :\n${text}` }];
      } else {
        setBusy('Lecture de l’image…');
        const block = await imageFileToBlock(file);
        messages = [{ role: 'user', content: [{ type: 'text', text: `${EXTRACT_INSTRUCTIONS}\n\nAnalyse cette capture d’écran :` }, block] }];
      }
      setBusy('Analyse des intervenants par l’IA…');
      const r = await callAIProxy({ feature: 'pdf_contacts', json: true, max_tokens: 2000, messages });
      const raw = r.content?.[0]?.text || '';
      let parsed; try { parsed = JSON.parse((raw.match(/\{[\s\S]*\}/) || [''])[0]); } catch { parsed = null; }
      const list = Array.isArray(parsed?.contacts) ? parsed.contacts : [];
      const clean = list
        .map(c => ({ nom:(c.nom||'').trim(), poste:(c.poste||'').trim(), entreprise:(c.entreprise||'').trim(), email:(c.email||'').trim(), tel:(c.tel||'').trim() }))
        .filter(c => c.nom);
      if (!clean.length) { setErr('Aucun intervenant détecté.'); setBusy(''); return; }
      const { toAdd, present, review } = classifyPdfImport(clean, existingContacts);
      setResult({ rows: [
        ...toAdd.map(c => ({ status:'new', sel:true, contact:c, match:null })),
        ...review.map(rv => ({ status:'near', sel:false, contact:rv.parsed, match:rv.match })),
        ...present.map(pr => ({ status:'present', sel:false, contact:pr.parsed, match:pr.match })),
      ] });
      setBusy('');
    } catch (e) { setErr(e?.message || 'Échec de l’analyse'); setBusy(''); }
  };

  const confirm = async () => {
    if (!result) return;
    setSaving(true);
    try {
      const chosen = result.rows.filter(x => x.sel && x.status !== 'present').map(x => x.contact);
      await onImported?.(chosen);
      setResult(null);
    } catch (e) { setErr(e?.message || 'Erreur'); }
    setSaving(false);
  };

  const BADGE = {
    new:     { bg:'#ECFDF5', bd:'#A7F3D0', fg:'#065F46', label:'Nouveau' },
    near:    { bg:'#FFFBEB', bd:'#FCD34D', fg:'#92400E', label:'Nom proche' },
    present: { bg:'#F3F4F6', bd:'#E5E7EB', fg:'#6B7280', label:'Déjà enregistré' },
  };
  const rows = result?.rows || [];
  const nSel = rows.filter(r => r.sel && r.status !== 'present').length;
  const toggle = (i) => setResult(r => ({ ...r, rows: r.rows.map((y, j) => j === i && y.status !== 'present' ? { ...y, sel: !y.sel } : y) }));

  return (
    <>
      <button onClick={() => fileRef.current?.click()} disabled={!!busy} title="Importer les intervenants depuis un PDF ou une capture d’écran (IA)"
        style={{ display:'flex', alignItems:'center', gap:5, fontSize:12, fontWeight:700, padding:'8px 12px', borderRadius:8, border:`1px solid ${DA.border}`, background:'white', color: busy ? DA.grayL : '#6D28D9', cursor: busy ? 'default' : 'pointer' }}>
        <Ic n="fil" s={14}/> {busy ? '…' : label}
      </button>
      <input ref={fileRef} type="file" accept="application/pdf,.pdf,image/*" style={{ display:'none' }}
        onChange={e => { const f = e.target.files?.[0]; if (f) analyze(f); e.target.value = ''; }}/>

      {(busy || (err && !result)) && (
        <div className="modal-overlay-dark" style={{ zIndex:10001 }} onClick={() => { if (!busy) setErr(''); }}>
          <div className="modal-sheet" style={{ maxWidth:380, padding:22, textAlign:'center' }} onClick={e => e.stopPropagation()}>
            {busy ? (
              <><div style={{ marginBottom:10 }}><Ic n="spn" s={26} color="#6D28D9"/></div>
                <p style={{ fontSize:14, color:DA.black, fontWeight:700, margin:0 }}>{busy}</p></>
            ) : (
              <><p style={{ fontSize:14, color:DA.red, fontWeight:700, margin:'0 0 14px' }}>{err}</p>
                <button onClick={() => setErr('')} style={{ padding:'10px 18px', borderRadius:9, border:'none', background:DA.red, color:'white', fontSize:13, fontWeight:800, cursor:'pointer' }}>OK</button></>
            )}
          </div>
        </div>
      )}

      {result && (
        <div className="modal-overlay-dark" style={{ zIndex:10001 }} onClick={() => setResult(null)}>
          <div className="modal-sheet" style={{ maxWidth:560, padding:20, maxHeight:'90vh', display:'flex', flexDirection:'column' }} onClick={e => e.stopPropagation()}>
            <p style={{ fontWeight:800, fontSize:16, color:DA.black, margin:'0 0 4px' }}>{rows.length} intervenant{rows.length > 1 ? 's' : ''} trouvé{rows.length > 1 ? 's' : ''}</p>
            <p style={{ fontSize:11, color:DA.grayL, margin:'0 0 12px' }}>Coche qui ajouter. Les « déjà enregistré » sont verrouillés (aucun doublon possible).</p>
            <div style={{ flex:1, overflowY:'auto', display:'flex', flexDirection:'column', gap:6 }}>
              {rows.map((x, i) => {
                const b = BADGE[x.status]; const locked = x.status === 'present';
                return (
                  <label key={i} style={{ display:'flex', alignItems:'flex-start', gap:10, padding:'8px 10px', borderRadius:9,
                    border:`1px solid ${b.bd}`, background:b.bg, cursor: locked ? 'default' : 'pointer', opacity: locked ? 0.7 : 1 }}>
                    <input type="checkbox" checked={x.sel} disabled={locked} onChange={() => toggle(i)}
                      style={{ marginTop:3, accentColor:DA.red, width:17, height:17, flexShrink:0 }}/>
                    <div style={{ minWidth:0, flex:1 }}>
                      <div style={{ display:'flex', alignItems:'center', gap:7, flexWrap:'wrap' }}>
                        <span style={{ fontSize:13.5, fontWeight:800, color:DA.black }}>{x.contact.nom}</span>
                        <span style={{ fontSize:10, fontWeight:800, color:b.fg, background:'white', border:`1px solid ${b.bd}`, borderRadius:5, padding:'1px 7px', textTransform:'uppercase', letterSpacing:0.3 }}>{b.label}</span>
                      </div>
                      <div style={{ fontSize:11.5, color:DA.gray, marginTop:1 }}>{[x.contact.poste, x.contact.entreprise, x.contact.email, x.contact.tel].filter(Boolean).join(' · ') || '—'}</div>
                      {x.match && (
                        <div style={{ fontSize:11, color:b.fg, marginTop:2 }}>
                          {x.status === 'present' ? '● identique à ' : '≈ ressemble à '}<strong>{x.match.nom}</strong>{x.match.entreprise ? ` (${x.match.entreprise})` : ''}
                        </div>
                      )}
                    </div>
                  </label>
                );
              })}
            </div>
            {err && <div style={{ fontSize:12, color:DA.red, marginTop:8 }}>{err}</div>}
            <div style={{ display:'flex', gap:8, marginTop:14 }}>
              <button onClick={() => setResult(null)} style={{ flex:1, padding:'11px', borderRadius:9, border:`1px solid ${DA.border}`, background:'white', color:DA.gray, fontSize:13, fontWeight:600, cursor:'pointer' }}>Annuler</button>
              <button onClick={confirm} disabled={saving || nSel === 0}
                style={{ flex:2, padding:'11px', borderRadius:9, border:'none', background: nSel === 0 ? DA.grayL : DA.red, color:'white', fontSize:13, fontWeight:800, cursor: nSel === 0 ? 'default' : 'pointer' }}>
                {saving ? 'Ajout…' : nSel === 0 ? 'Rien de sélectionné' : `Ajouter ${nSel} intervenant${nSel > 1 ? 's' : ''}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
