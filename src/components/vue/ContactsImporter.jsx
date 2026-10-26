import React, { useState, useRef, useEffect } from 'react';
import { DA } from '../../lib/constants.js';
import { Ic } from '../ui/Icons.jsx';
import { upsertContact } from '../../lib/contacts.js';
import { getPdfText, renderPdfPages, getPdfPageCount } from '../../lib/pdfUtils.js';
import { callAIProxy } from '../../lib/aiProxy.js';
import { logWarn } from '../../lib/logger.js';
import { EXTRACT_PROMPT, parseContactsJson, mergeDuplicates, fillBlanks, statusOf } from '../../lib/contactExtract.js';

// IMPORTER DES INTERVENANTS par l'IA — PDF (CR d'archi…), capture d'écran COLLÉE (Ctrl+V),
// image déposée ou photo. Refonte 26/10 (Thomas : « ça n'a pas marché avec un PDF, pas très
// user friendly ») :
//   • PDF : l'IA lit le texte ET voit les premières pages en image (tableaux, PDF scannés) ;
//     réponse plus longue autorisée + récupération si elle est coupée (longues listes) ;
//   • une seule fenêtre : coller / déposer / choisir, plusieurs captures à la suite ;
//   • fiches PRÉ-REMPLIES (nom, métier, entreprise, e-mail, tél., présence) et modifiables
//     avant validation ; on coche qui importer ;
//   • DOUBLONS : déjà au carnet → jamais recréé (on complète seulement ses champs vides) ;
//     nom proche → « même personne ? » ; cité deux fois → fusionné.
//
// Props :
//   existingContacts : le carnet (détection des doublons)
//   alreadyListed(c) : (page de garde) true si la personne figure déjà dans la liste
//   mode             : 'participants' (ajoute aussi à la liste) | 'carnet'
//   onImported(list) : contacts validés (avec id carnet + presence), après écriture au carnet
//   label            : libellé du bouton

function blobToJpegBlock(src, maxSide = 1600) {
  return new Promise((resolve, reject) => {
    const isBlob = typeof src !== 'string';
    const url = isBlob ? URL.createObjectURL(src) : src;
    const im = new window.Image();
    const done = () => { if (isBlob) URL.revokeObjectURL(url); };
    im.onload = () => {
      try {
        const scale = Math.min(1, maxSide / Math.max(im.naturalWidth, im.naturalHeight));
        const W = Math.max(1, Math.round(im.naturalWidth * scale)), H = Math.max(1, Math.round(im.naturalHeight * scale));
        const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
        const ctx = cv.getContext('2d');
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
        ctx.drawImage(im, 0, 0, W, H);
        const b64 = cv.toDataURL('image/jpeg', 0.85).split(',')[1];
        cv.width = 0; cv.height = 0; done();
        resolve({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: b64 } });
      } catch (e) { done(); reject(e); }
    };
    im.onerror = (e) => { done(); reject(e); };
    im.src = url;
  });
}
function fileToDataUrl(file) {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); });
}

const BADGE = {
  new:     { bg:'#ECFDF5', bd:'#A7F3D0', fg:'#065F46', label:'Nouveau' },
  near:    { bg:'#FFFBEB', bd:'#FCD34D', fg:'#92400E', label:'À confirmer' },
  present: { bg:'#F3F4F6', bd:'#E5E7EB', fg:'#4B5563', label:'Déjà au carnet' },
  listed:  { bg:'#F3F4F6', bd:'#E5E7EB', fg:'#6B7280', label:'Déjà dans la liste' },
};
const FIELDS = [['nom', 'Nom *'], ['poste', 'Métier / rôle'], ['entreprise', 'Entreprise'], ['email', 'E-mail'], ['tel', 'Téléphone']];

export default function ContactsImporter({ existingContacts = [], alreadyListed = null, mode = 'carnet', onImported, label = 'PDF / Photo' }) {
  const fileRef = useRef();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [rows, setRows] = useState([]); // { contact, sel, same(bool|null pour 'near'), editing }
  const [saving, setSaving] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  // Statut recalculé en direct (une correction du nom peut changer le statut).
  const view = rows.map(r => {
    const st = statusOf(r.contact, existingContacts);
    let status = st.status;
    if (status === 'near' && r.same === true) status = 'present';
    if (status === 'near' && r.same === false) status = 'new';
    const listed = mode === 'participants' && alreadyListed?.(st.status === 'near' && r.same !== true ? r.contact : (st.match || r.contact));
    const fill = st.match && status === 'present' ? fillBlanks(st.match, r.contact) : {};
    return { ...r, status: listed ? 'listed' : status, rawStatus: st.status, match: st.match, fill };
  });
  // Coché = fera quelque chose : créer (nouveau) / ajouter à la liste / compléter la fiche.
  const actionable = (v) => v.status === 'new' || (v.status === 'present' && (mode === 'participants' || Object.keys(v.fill).length > 0));
  const chosen = view.filter(v => v.sel && actionable(v));

  const addParsed = (list) => {
    setRows(prev => {
      const merged = mergeDuplicates([...prev.map(r => r.contact), ...list]);
      return merged.map(c => {
        const old = prev.find(r => r.contact.nom === c.nom);
        if (old) return { ...old, contact: { ...old.contact, ...Object.fromEntries(Object.entries(c).filter(([k, v]) => v && !old.contact[k])) } };
        const st = statusOf(c, existingContacts);
        const listed = mode === 'participants' && alreadyListed?.(st.match || c);
        return { contact: c, sel: !listed && (st.status === 'new' || st.status === 'near' || mode === 'participants'), same: st.status === 'near' ? true : null, editing: false };
      });
    });
  };

  const analyze = async (file) => {
    if (!file) return;
    setErr('');
    const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name || '');
    const isImg = (file.type || '').startsWith('image/') || /\.(png|jpe?g|webp|heic|gif)$/i.test(file.name || '');
    if (!isPdf && !isImg) { setErr('Format non reconnu : PDF ou image (capture d’écran, photo).'); return; }
    try {
      const content = [];
      if (isPdf) {
        setBusy('Lecture du PDF…');
        const dataUrl = await fileToDataUrl(file);
        const text = await getPdfText(dataUrl).catch(() => '');
        // Pages en image : l'IA voit les TABLEAUX (colonnes Société / Nom / Fonction / P-A-E) et
        // lit les PDF scannés. 2 pages si le texte est lisible, 4 sinon.
        const total = await getPdfPageCount(dataUrl).catch(() => 1);
        const nPages = Math.max(1, Math.min(total || 1, text && text.length > 200 ? 2 : 4));
        const pages = await renderPdfPages(dataUrl, Array.from({ length: nPages }, (_, i) => i + 1), { maxScale: 2.5, maxWidth: 1500, quality: 0.85, concurrency: 2 }).catch(() => []);
        for (const p of pages) if (p?.img) { try { content.push(await blobToJpegBlock(p.img)); } catch { /* page ignorée */ } }
        if (!content.length && (!text || text.length < 20)) throw new Error('PDF illisible — essayez une capture d’écran de la liste des intervenants.');
        content.unshift({ type: 'text', text: `${EXTRACT_PROMPT}${text ? `\n\nTEXTE DU PDF (les images montrent les premières pages, utile pour les tableaux) :\n${text}` : '\n\nLes images sont les pages du PDF.'}` });
      } else {
        setBusy('Lecture de l’image…');
        content.push({ type: 'text', text: EXTRACT_PROMPT }, await blobToJpegBlock(file));
      }
      setBusy('L’IA repère les intervenants…');
      const r = await callAIProxy({ feature: 'pdf_contacts', json: true, max_tokens: 4096, _throttleMs: 1500, _waitOk: true, messages: [{ role: 'user', content }] });
      const list = parseContactsJson(r?.content?.[0]?.text || '');
      if (!list.length) throw new Error('Aucun intervenant trouvé dans ce document.');
      addParsed(list);
    } catch (e) {
      const msg = e?.message || 'Échec de l’analyse';
      logWarn('contacts.import', { kind: isPdf ? 'pdf' : 'image', error: msg });
      setErr(msg);
    }
    setBusy('');
  };

  // Ctrl+V d'une capture pendant que la fenêtre est ouverte.
  useEffect(() => {
    if (!open) return undefined;
    const onPaste = (e) => {
      const files = [...(e.clipboardData?.files || [])].filter(f => /^image\/|application\/pdf/.test(f.type));
      if (!files.length) return;
      e.preventDefault();
      (async () => { for (const f of files) await analyze(f); })();
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [open, existingContacts]); // eslint-disable-line react-hooks/exhaustive-deps

  const close = () => { if (busy || saving) return; setOpen(false); setRows([]); setErr(''); };
  const setRow = (i, patch) => setRows(rs => rs.map((r, j) => j === i ? { ...r, ...patch } : r));
  const setField = (i, k, v) => setRows(rs => rs.map((r, j) => j === i ? { ...r, contact: { ...r.contact, [k]: v } } : r));

  const confirm = async () => {
    if (!chosen.length) return;
    setSaving(true); setErr('');
    const out = []; let failed = 0;
    for (const v of chosen) {
      const c = { ...v.contact, nom: v.contact.nom.trim() };
      try {
        if (v.status === 'new') {
          const { presence, ...data } = c;
          const id = await upsertContact({ ...data, isAssemblage: false });
          out.push({ ...data, id, isAssemblage: false, presence });
        } else {
          // Déjà au carnet : pas de doublon, on complète seulement les champs vides.
          const m = v.match;
          if (Object.keys(v.fill).length) await upsertContact({ ...m, ...v.fill, id: m.id });
          out.push({ ...m, ...v.fill, presence: c.presence });
        }
      } catch (e) {
        failed++;
        logWarn('contacts.import.save', { error: String(e?.message || e) });
        if (v.status === 'new') { const { presence, ...data } = c; out.push({ ...data, isAssemblage: false, presence }); }
      }
    }
    try { await onImported?.(out); } catch (e) { setErr(e?.message || 'Erreur'); setSaving(false); return; }
    setSaving(false);
    if (failed) { setErr(`${failed} fiche${failed > 1 ? 's' : ''} non enregistrée${failed > 1 ? 's' : ''} au carnet (réseau ?) — ajoutée${failed > 1 ? 's' : ''} quand même à la liste.`); setRows([]); return; }
    setOpen(false); setRows([]);
  };

  const nNew = chosen.filter(v => v.status === 'new').length;
  const cta = mode === 'participants'
    ? `Ajouter ${chosen.length} intervenant${chosen.length > 1 ? 's' : ''}${nNew ? ` (${nNew} au carnet)` : ''}`
    : `Ajouter ${nNew} au carnet${chosen.length > nNew ? ` · compléter ${chosen.length - nNew}` : ''}`;
  const inp = { width:'100%', minWidth:0, fontSize:16, border:`1px solid ${DA.border}`, borderRadius:6, padding:'5px 8px', outline:'none', boxSizing:'border-box', fontFamily:'inherit', background:'white' };

  return (
    <>
      <button onClick={() => setOpen(true)} title="Importer des intervenants depuis un PDF ou une capture d’écran (IA)"
        style={{ display:'flex', alignItems:'center', gap:5, fontSize:12, fontWeight:700, padding:'8px 12px', borderRadius:8, border:`1px solid ${DA.border}`, background:'white', color:'#6D28D9', cursor:'pointer' }}>
        <Ic n="fil" s={14}/> {label}
      </button>
      <input ref={fileRef} type="file" multiple accept="application/pdf,.pdf,image/*" style={{ display:'none' }}
        onChange={e => { const fs = [...(e.target.files || [])]; e.target.value = ''; (async () => { for (const f of fs) await analyze(f); })(); }}/>

      {open && (
        <div className="modal-overlay-dark" style={{ zIndex:10001 }} onClick={close}>
          <div className="modal-sheet" style={{ maxWidth:560, padding:18, maxHeight:'92vh', display:'flex', flexDirection:'column', gap:10 }} onClick={e => e.stopPropagation()}>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
              <p style={{ fontWeight:800, fontSize:16, color:DA.black, margin:0 }}>Importer des intervenants</p>
              <button onClick={close} aria-label="Fermer" style={{ border:'none', background:'none', cursor:'pointer', color:DA.gray, padding:4, display:'flex' }}><Ic n="x" s={18}/></button>
            </div>

            {/* Zone : coller / déposer / choisir — compacte dès qu'il y a des fiches. */}
            <div onClick={() => !busy && fileRef.current?.click()}
              onDragOver={e => { e.preventDefault(); setDragOver(true); }} onDragLeave={() => setDragOver(false)}
              onDrop={e => { e.preventDefault(); setDragOver(false); const fs = [...(e.dataTransfer?.files || [])]; (async () => { for (const f of fs) await analyze(f); })(); }}
              style={{ border:`2px dashed ${dragOver ? '#6D28D9' : '#C4B5FD'}`, background: dragOver ? '#F5F3FF' : '#FAF9FF', borderRadius:12,
                padding: rows.length ? '10px 12px' : '22px 14px', textAlign:'center', cursor: busy ? 'default' : 'pointer' }}>
              {busy ? (
                <div style={{ display:'flex', alignItems:'center', justifyContent:'center', gap:8, color:'#6D28D9', fontSize:13, fontWeight:700 }}><Ic n="spn" s={18} color="#6D28D9"/> {busy}</div>
              ) : rows.length ? (
                <div style={{ fontSize:12.5, color:'#6D28D9', fontWeight:700 }}>+ Ajouter une autre capture ou un autre PDF</div>
              ) : (
                <>
                  <div style={{ fontSize:14, fontWeight:800, color:'#4C1D95', marginBottom:4 }}>Collez une capture d’écran <span style={{ fontWeight:600, color:'#7C3AED' }}>(Ctrl+V)</span></div>
                  <div style={{ fontSize:12.5, color:DA.gray, lineHeight:1.5 }}>ou déposez / choisissez un PDF (compte-rendu, liste de diffusion…) ou une photo.<br/>L’IA pré-remplit nom, métier, entreprise, e-mail, téléphone — vous validez ensuite.</div>
                </>
              )}
            </div>
            {err && <div style={{ fontSize:12.5, color:DA.red, background:'#FEF2F2', border:'1px solid #FECACA', borderRadius:8, padding:'7px 10px' }}>{err}</div>}

            {rows.length > 0 && (
              <>
                <p style={{ fontSize:11.5, color:DA.grayL, margin:0 }}>
                  {view.length} trouvé{view.length > 1 ? 's' : ''} — cochez qui importer, touchez une fiche pour la corriger. Les personnes déjà au carnet ne sont jamais ajoutées en double.
                </p>
                <div style={{ flex:1, overflowY:'auto', display:'flex', flexDirection:'column', gap:6, minHeight:0 }}>
                  {view.map((v, i) => {
                    const b = BADGE[v.status]; const can = actionable(v);
                    return (
                      <div key={i} style={{ display:'flex', alignItems:'flex-start', gap:10, padding:'8px 10px', borderRadius:9, border:`1px solid ${b.bd}`, background:b.bg, opacity: can ? 1 : 0.65 }}>
                        <input type="checkbox" checked={!!v.sel && can} disabled={!can} onChange={() => setRow(i, { sel: !v.sel })}
                          aria-label={`Importer ${v.contact.nom}`} style={{ marginTop:3, accentColor:DA.red, width:17, height:17, flexShrink:0 }}/>
                        <div style={{ minWidth:0, flex:1 }}>
                          {v.editing ? (
                            <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
                              {FIELDS.map(([k, l]) => <input key={k} value={v.contact[k] || ''} placeholder={l} aria-label={l} onChange={e => setField(i, k, e.target.value)} style={inp}/>)}
                              <button onClick={() => setRow(i, { editing: false })} disabled={!v.contact.nom.trim()}
                                style={{ alignSelf:'flex-start', padding:'5px 12px', borderRadius:7, border:'none', background:DA.black, color:'white', fontSize:12, fontWeight:700, cursor:'pointer' }}>OK</button>
                            </div>
                          ) : (
                            <div onClick={() => setRow(i, { editing: true })} style={{ cursor:'pointer' }} title="Corriger cette fiche">
                              <div style={{ display:'flex', alignItems:'center', gap:7, flexWrap:'wrap' }}>
                                <span style={{ fontSize:13.5, fontWeight:800, color:DA.black }}>{v.contact.nom}</span>
                                <span style={{ fontSize:10, fontWeight:800, color:b.fg, background:'white', border:`1px solid ${b.bd}`, borderRadius:5, padding:'1px 7px', textTransform:'uppercase', letterSpacing:0.3 }}>{b.label}</span>
                                {v.contact.presence && <span style={{ fontSize:10.5, color: v.contact.presence === 'present' ? '#065F46' : DA.gray }}>{v.contact.presence === 'present' ? 'présent' : 'absent'}</span>}
                                <Ic n="pen" s={11} color={DA.grayL}/>
                              </div>
                              <div style={{ fontSize:11.5, color:DA.gray, marginTop:1 }}>{[v.contact.poste, v.contact.entreprise, v.contact.email, v.contact.tel].filter(Boolean).join(' · ') || '—'}</div>
                              {v.rawStatus === 'near' && v.match && (
                                <div onClick={e => e.stopPropagation()} style={{ display:'flex', alignItems:'center', gap:6, flexWrap:'wrap', marginTop:4, fontSize:11.5, color:'#92400E' }}>
                                  ≈ <strong>{v.match.nom}</strong>{v.match.entreprise ? ` (${v.match.entreprise})` : ''} au carnet — même personne ?
                                  {[[true, 'Oui'], [false, 'Non, nouvelle']].map(([val, l]) => (
                                    <button key={l} onClick={() => setRow(i, { same: val, sel: true })}
                                      style={{ padding:'2px 9px', borderRadius:6, fontSize:11, fontWeight:700, cursor:'pointer', border:`1px solid ${v.same === val ? '#92400E' : '#FCD34D'}`, background: v.same === val ? '#92400E' : 'white', color: v.same === val ? 'white' : '#92400E' }}>{l}</button>
                                  ))}
                                </div>
                              )}
                              {v.status === 'present' && v.match && (v.rawStatus !== 'near' || Object.keys(v.fill).length > 0) && (
                                <div style={{ fontSize:11, color:b.fg, marginTop:2 }}>
                                  {v.rawStatus === 'near' ? 'fiche du carnet' : <>au carnet : <strong>{v.match.nom}</strong></>}{Object.keys(v.fill).length ? ` — complété : ${Object.keys(v.fill).map(k => ({ poste:'métier', entreprise:'entreprise', email:'e-mail', tel:'tél.' }[k])).join(', ')}` : ''}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div style={{ display:'flex', gap:8 }}>
                  <button onClick={close} style={{ flex:1, padding:'11px', borderRadius:9, border:`1px solid ${DA.border}`, background:'white', color:DA.gray, fontSize:13, fontWeight:600, cursor:'pointer' }}>Annuler</button>
                  <button onClick={confirm} disabled={saving || !!busy || !chosen.length}
                    style={{ flex:2, padding:'11px', borderRadius:9, border:'none', background: !chosen.length ? DA.grayL : DA.red, color:'white', fontSize:13, fontWeight:800, cursor: !chosen.length ? 'default' : 'pointer' }}>
                    {saving ? 'Ajout…' : !chosen.length ? 'Rien de sélectionné' : cta}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
