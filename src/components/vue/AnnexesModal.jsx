import React, { useState, useRef } from 'react';
import { DA } from '../../lib/constants.js';
import { Ic } from '../ui/Icons.jsx';
import { resolveDriveFolder, browseDriveFolder, downloadDrivePlan, fmtDriveSize } from '../../lib/drivePlans.js';
import { uploadAnnexPdf, deleteAnnexPdf } from '../../lib/storage.js';
import { getPdfPageCount } from '../../lib/pdfUtils.js';

// ── Annexes du rapport ────────────────────────────────────────────────────────────────────
// Documents PDF joints EN FIN de rapport (une page de garde « ANNEXES » récapitule leurs noms,
// puis chaque PDF est imprimé à la suite). Import par glisser-déposer / parcourir OU depuis le
// Drive de l'affaire (mêmes fonctions que la bibliothèque de plans). Les OCTETS vivent dans
// Storage (uploadAnnexPdf) ; seules les métadonnées {id, name, pageCount, size} sont conservées
// sur la visite → JSON du projet léger, aucune régression de persistance.
const MAX_ANNEX_BYTES = 60 * 1024 * 1024; // 60 Mo par document (garde-fou, comme les plans Drive)

export default function AnnexesModal({ annexes = [], onAdd, onDelete, projetNom = '', projetId = null, onClose }) {
  const [busy, setBusy] = useState(null); // { name, idx, total } — import en cours
  const [err, setErr] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef();

  // Drive de l'affaire (navigation niveau par niveau — repris de la bibliothèque de plans).
  const [driveOpen, setDriveOpen] = useState(false);
  const [driveLoading, setDriveLoading] = useState(false);
  const [drivePath, setDrivePath] = useState([]);
  const [driveContent, setDriveContent] = useState(null);
  const [driveErr, setDriveErr] = useState(null);
  const [driveSel, setDriveSel] = useState(new Map());
  const driveIdRef = useRef(null);

  // Ajoute UN document : upload du PDF (Storage) + métadonnées (nb pages). onProgress via setBusy.
  const addOne = async (name, pdfDataUrl, size) => {
    const id = crypto.randomUUID();
    const pageCount = await getPdfPageCount(pdfDataUrl).catch(() => 0);
    const ok = projetId ? await uploadAnnexPdf(projetId, id, pdfDataUrl) : false;
    if (!ok) throw new Error(`Échec de l'envoi de « ${name} »`);
    onAdd({ id, name: name.replace(/\.[^.]+$/, ''), pageCount: pageCount || 1, size: size || 0 });
  };

  // Fichiers locaux (input OU glisser-déposer) : uniquement des PDF.
  const processFiles = async (fileList) => {
    const files = Array.from(fileList || []).filter(Boolean);
    if (!files.length) return;
    setErr(null);
    const pdfs = [], bad = [];
    for (const f of files) {
      if (f.type !== 'application/pdf') { bad.push(f.name); continue; }
      if (f.size > MAX_ANNEX_BYTES) { bad.push(`${f.name} (trop volumineux)`); continue; }
      pdfs.push(f);
    }
    if (bad.length) setErr(`Ignoré(s) — PDF uniquement, max 60 Mo : ${bad.join(', ')}`);
    for (let i = 0; i < pdfs.length; i++) {
      const f = pdfs[i];
      setBusy({ name: f.name, idx: i + 1, total: pdfs.length });
      try {
        const dataUrl = await new Promise((res, rej) => {
          const r = new FileReader();
          r.onload = () => res(r.result); r.onerror = () => rej(new Error('lecture impossible'));
          r.readAsDataURL(f);
        });
        await addOne(f.name, dataUrl, f.size);
      } catch (e) { setErr(e.message || String(e)); }
    }
    setBusy(null);
  };

  const handleFile = e => { processFiles(e.target.files); e.target.value = ''; };
  const onDrop = e => {
    e.preventDefault(); setDragOver(false);
    if (e.dataTransfer?.files?.length) processFiles(e.dataTransfer.files);
  };

  const browseTo = async (path, { fresh = false } = {}) => {
    setDriveLoading(true); setDriveErr(null);
    try {
      const content = await browseDriveFolder(path[path.length - 1].id, driveIdRef.current, { fresh });
      setDrivePath(path); setDriveContent(content);
    } catch (e) { setDriveErr(e.message); }
    setDriveLoading(false);
  };

  const openDrive = async () => {
    setDriveOpen(true);
    if (driveContent != null) return;
    setDriveLoading(true); setDriveErr(null);
    try {
      const { folderId, folderName, driveId } = await resolveDriveFolder(projetNom);
      if (!folderId) {
        setDriveErr(`Dossier introuvable dans le Drive pour « ${projetNom} » — le nom du projet doit contenir le numéro d'affaire.`);
        setDriveLoading(false); return;
      }
      driveIdRef.current = driveId || null;
      await browseTo([{ id: folderId, name: folderName }]);
    } catch (e) { setDriveErr(e.message); setDriveLoading(false); }
  };

  const toggleDriveSel = (f) => {
    if (busy) return;
    setDriveSel(prev => { const next = new Map(prev); if (next.has(f.id)) next.delete(f.id); else next.set(f.id, f); return next; });
  };

  const importDriveSelection = async () => {
    const files = [...driveSel.values()];
    if (!files.length || busy) return;
    setErr(null); setDriveErr(null);
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      setBusy({ name: f.name, idx: i + 1, total: files.length, pct: 0 });
      try {
        const dataUrl = await downloadDrivePlan(f.id, (got, total) =>
          setBusy({ name: f.name, idx: i + 1, total: files.length, pct: total ? Math.round(got / total * 100) : 0 }));
        await addOne(f.name, dataUrl, f.size);
      } catch (e) { setErr(`« ${f.name} » : ${e.message || e}`); }
    }
    setBusy(null);
    setDriveSel(new Map());
    setDriveOpen(false);
  };

  const removeAnnex = async (a) => {
    onDelete(a.id);                                    // retire la métadonnée (immédiat)
    if (projetId) { try { await deleteAnnexPdf(projetId, a.id); } catch { /* best-effort */ } }
  };

  return (
    <div className="modal-overlay" style={{ zIndex:60 }}>
      <div className="modal-sheet-flex">
        {/* Header */}
        <div style={{ padding:'16px 18px 14px', borderBottom:`1px solid ${DA.border}`, flexShrink:0 }}>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:4 }}>
            <div style={{ display:'flex', alignItems:'center', gap:8 }}>
              <Ic n="fil" s={18}/>
              <p style={{ fontWeight:800, fontSize:15, color:DA.black, margin:0 }}>Annexes du rapport</p>
            </div>
            <button onClick={onClose} style={{ background:'none', border:'none', cursor:'pointer', color:DA.grayL }}><Ic n="x" s={20}/></button>
          </div>
          <p style={{ fontSize:12, color:DA.gray, margin:0 }}>Des PDF ajoutés à la fin du rapport, précédés d'une page « Annexes ».</p>
        </div>

        {/* Corps */}
        <div style={{ flex:1, overflowY:'auto', padding:14 }}>
          {/* Zone d'import : glisser-déposer OU parcourir */}
          <div
            onClick={() => !busy && fileRef.current.click()}
            onDragOver={e => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={e => { e.preventDefault(); setDragOver(false); }}
            onDrop={onDrop}
            style={{
              display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:6,
              padding:'22px 16px', marginBottom:14, borderRadius:14, textAlign:'center',
              border:`2px dashed ${dragOver ? DA.red : '#C9CDD2'}`,
              background: dragOver ? DA.redL : '#FAFBFC',
              cursor: busy ? 'default' : 'pointer', transition:'all 0.12s', userSelect:'none',
            }}>
            <div style={{ width:42, height:42, borderRadius:'50%', background: dragOver ? DA.red : '#EEF0F2', display:'flex', alignItems:'center', justifyContent:'center', color: dragOver ? 'white' : DA.gray }}>
              <Ic n="plus" s={22}/>
            </div>
            <p style={{ fontSize:14, fontWeight:800, color:DA.black, margin:'2px 0 0' }}>Glissez vos PDF ici</p>
            <p style={{ fontSize:12, color:DA.gray, margin:0 }}>
              ou <span style={{ color:DA.red, fontWeight:700 }}>cliquez pour parcourir</span> — PDF uniquement · plusieurs à la fois
            </p>
          </div>
          <input ref={fileRef} type="file" accept="application/pdf" multiple style={{ display:'none' }} onChange={handleFile}/>

          {/* Drive de l'affaire */}
          <div style={{ marginBottom:14 }}>
            <button onClick={() => driveOpen ? setDriveOpen(false) : openDrive()}
              style={{ width:'100%', display:'flex', alignItems:'center', gap:10, padding:'12px 14px', borderRadius:12,
                border:`1.5px solid ${driveOpen ? DA.red : DA.border}`, background:'white', cursor:'pointer', textAlign:'left' }}>
              <span style={{ fontSize:17, flexShrink:0 }}>📁</span>
              <span style={{ flex:1, minWidth:0 }}>
                <span style={{ display:'block', fontSize:13, fontWeight:800, color:DA.black }}>Drive de l'affaire</span>
                <span style={{ display:'block', fontSize:11, color:DA.grayL, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                  {drivePath.length ? `Dossier : ${drivePath[0].name}` : 'Chercher les PDF dans l\'arborescence du projet'}
                </span>
              </span>
              <span style={{ flexShrink:0, fontSize:11, color:DA.grayL }}>{driveOpen ? '▴' : '▾'}</span>
            </button>
            {driveOpen && (
              <div style={{ border:`1px solid ${DA.border}`, borderTop:'none', borderRadius:'0 0 12px 12px', margin:'0 6px', background:'#FAFBFC', maxHeight:340, overflowY:'auto' }}>
                {drivePath.length > 0 && (
                  <div style={{ display:'flex', alignItems:'center', gap:6, padding:'8px 10px', borderBottom:`1px solid ${DA.grayXL}`, position:'sticky', top:0, background:'#FAFBFC', zIndex:1 }}>
                    {drivePath.length > 1 && (
                      <button onClick={() => browseTo(drivePath.slice(0, -1))} disabled={driveLoading} title="Remonter d'un niveau"
                        style={{ flexShrink:0, width:30, height:30, borderRadius:8, border:`1px solid ${DA.border}`, background:'white', color:DA.gray, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', fontSize:15, fontWeight:800 }}>
                        ‹
                      </button>
                    )}
                    <button onClick={() => browseTo(drivePath, { fresh: true })} disabled={driveLoading} title="Actualiser ce dossier"
                      style={{ flexShrink:0, width:30, height:30, borderRadius:8, border:`1px solid ${DA.border}`, background:'white', color:DA.gray, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', order:99 }}>
                      <Ic n="rld" s={13}/>
                    </button>
                    <div style={{ flex:1, minWidth:0, fontSize:11, color:DA.grayL, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', direction:'rtl', textAlign:'left' }}>
                      <span style={{ direction:'ltr', unicodeBidi:'embed' }}>
                        {drivePath.map((p, i) => (
                          <span key={p.id}>
                            {i > 0 && ' / '}
                            <button onClick={() => i < drivePath.length - 1 && browseTo(drivePath.slice(0, i + 1))}
                              style={{ background:'none', border:'none', padding:0, cursor: i < drivePath.length - 1 ? 'pointer' : 'default',
                                fontSize:11, fontWeight: i === drivePath.length - 1 ? 800 : 600,
                                color: i === drivePath.length - 1 ? DA.black : DA.grayL }}>
                              {p.name}
                            </button>
                          </span>
                        ))}
                      </span>
                    </div>
                  </div>
                )}
                {driveLoading && (
                  <p style={{ display:'flex', alignItems:'center', gap:8, fontSize:12, color:DA.gray, margin:0, padding:'12px 14px' }}>
                    <Ic n="spn" s={13}/> {drivePath.length ? 'Ouverture du dossier…' : 'Recherche du dossier de l\'affaire…'}
                  </p>
                )}
                {driveErr && <p style={{ fontSize:12, color:'#B91C1C', margin:0, padding:'12px 14px' }}>⚠️ {driveErr}</p>}
                {!driveLoading && !driveErr && driveContent != null && driveContent.folders.length === 0 && driveContent.files.length === 0 && (
                  <p style={{ fontSize:12, color:DA.grayL, margin:0, padding:'12px 14px' }}>Dossier vide (aucun sous-dossier ni PDF).</p>
                )}
                {!driveLoading && (driveContent?.folders || []).map(f => (
                  <button key={f.id} onClick={() => browseTo([...drivePath, f])} disabled={!!busy}
                    style={{ width:'100%', display:'flex', alignItems:'center', gap:9, padding:'10px 14px', background:'none',
                      border:'none', borderTop:`1px solid ${DA.grayXL}`, cursor: busy ? 'default' : 'pointer', textAlign:'left' }}>
                    <span style={{ fontSize:15, flexShrink:0 }}>📁</span>
                    <span style={{ flex:1, minWidth:0, fontSize:12.5, fontWeight:700, color:DA.black, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{f.name}</span>
                    <span style={{ flexShrink:0, color:DA.grayL, fontSize:14 }}>›</span>
                  </button>
                ))}
                {!driveLoading && (driveContent?.files || []).map(f => {
                  const sel = driveSel.has(f.id);
                  const tooBig = f.size > MAX_ANNEX_BYTES;
                  return (
                    <button key={f.id} onClick={() => !tooBig && toggleDriveSel(f)} disabled={!!busy || tooBig}
                      style={{ width:'100%', display:'flex', alignItems:'center', gap:9, padding:'9px 14px',
                        background: sel ? DA.redL : 'none',
                        border:'none', borderTop:`1px solid ${DA.grayXL}`, cursor: (busy || tooBig) ? 'default' : 'pointer',
                        textAlign:'left', opacity: tooBig ? 0.45 : 1 }}>
                      <span style={{ flexShrink:0, width:20, height:20, borderRadius:6, display:'flex', alignItems:'center', justifyContent:'center',
                        border:`2px solid ${sel ? DA.red : DA.border}`, background: sel ? DA.red : 'white', color:'white' }}>
                        {sel && <Ic n="chk" s={12}/>}
                      </span>
                      <span style={{ fontSize:13, flexShrink:0 }}>📄</span>
                      <span style={{ flex:1, minWidth:0 }}>
                        <span style={{ display:'block', fontSize:12, fontWeight:700, color: sel ? DA.red : DA.black, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{f.name}</span>
                        <span style={{ display:'block', fontSize:10.5, color:DA.grayL }}>
                          {[fmtDriveSize(f.size), tooBig ? 'trop volumineux (max 60 Mo)' : null].filter(Boolean).join(' · ')}
                        </span>
                      </span>
                    </button>
                  );
                })}
                {(driveSel.size > 0 || busy) && (
                  <div style={{ position:'sticky', bottom:0, padding:'8px 10px', background:'#FAFBFC', borderTop:`1px solid ${DA.grayXL}` }}>
                    <button onClick={importDriveSelection} disabled={!!busy}
                      style={{ width:'100%', padding:'11px 0', borderRadius:9, border:'none', background:DA.red, color:'white',
                        fontSize:13, fontWeight:800, cursor: busy ? 'default' : 'pointer', display:'flex', alignItems:'center', justifyContent:'center', gap:8 }}>
                      {busy
                        ? <><Ic n="spn" s={14}/> Document {busy.idx}/{busy.total}{busy.pct != null ? ` · ${busy.pct} %` : '…'}</>
                        : <>Importer {driveSel.size} document{driveSel.size > 1 ? 's' : ''}</>}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          {err && (
            <div style={{ background:'#FFF0F0', border:'1px solid #FCA5A5', borderRadius:8, padding:'10px 12px', marginBottom:12, fontSize:12, color:'#B91C1C' }}>
              ⚠️ {err}
            </div>
          )}
          {busy && !driveOpen && (
            <div style={{ display:'flex', alignItems:'center', gap:8, padding:'12px 0', color:DA.gray, justifyContent:'center' }}>
              <Ic n="spn" s={18}/><span style={{ fontSize:13 }}>Import {busy.idx}/{busy.total} — {busy.name}…</span>
            </div>
          )}

          {/* Liste des annexes ajoutées */}
          {annexes.length === 0 && !busy && (
            <div style={{ textAlign:'center', padding:'28px 0', color:DA.grayL }}>
              <Ic n="fil" s={38}/>
              <p style={{ fontSize:13, fontWeight:600, color:DA.gray, margin:'8px 0 4px' }}>Aucune annexe</p>
              <p style={{ fontSize:11, color:DA.grayL, margin:0 }}>Importez les PDF à joindre en fin de rapport</p>
            </div>
          )}
          <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
            {annexes.map((a, i) => (
              <div key={a.id} style={{ display:'flex', alignItems:'center', gap:10, padding:'10px 12px', borderRadius:12, border:`1px solid ${DA.border}`, background:DA.white }}>
                <div style={{ width:40, height:40, borderRadius:8, background:'#F2F4F6', display:'flex', alignItems:'center', justifyContent:'center', color:DA.gray, flexShrink:0, position:'relative' }}>
                  <Ic n="fil" s={18}/>
                  <span style={{ position:'absolute', bottom:-4, right:-4, background:DA.red, color:'white', fontSize:9, fontWeight:800, borderRadius:8, padding:'1px 5px', lineHeight:1.4 }}>{i + 1}</span>
                </div>
                <div style={{ flex:1, minWidth:0 }}>
                  <p style={{ fontWeight:700, fontSize:13, color:DA.black, margin:0, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{a.name}</p>
                  <p style={{ fontSize:10, color:DA.grayL, margin:'2px 0 0' }}>
                    {[`${a.pageCount || 1} page${(a.pageCount || 1) > 1 ? 's' : ''}`, a.size ? fmtDriveSize(a.size) : null].filter(Boolean).join(' · ')}
                  </p>
                </div>
                <button onClick={() => removeAnnex(a)} title="Retirer cette annexe"
                  style={{ padding:6, color:'#ccc', background:'none', border:'none', cursor:'pointer', flexShrink:0 }}
                  onMouseEnter={e => e.currentTarget.style.color = DA.red} onMouseLeave={e => e.currentTarget.style.color = '#ccc'}>
                  <Ic n="del" s={15}/>
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div style={{ padding:'12px 14px 20px', borderTop:`1px solid ${DA.border}`, flexShrink:0 }}>
          <button onClick={onClose}
            style={{ width:'100%', background:DA.red, color:'white', border:'none', borderRadius:12, padding:14, fontSize:14, fontWeight:700, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', gap:6 }}>
            <Ic n="chk" s={15}/> Terminer
          </button>
        </div>
      </div>
    </div>
  );
}
