import React, { useState, useRef } from 'react';
import { DA } from '../../lib/constants.js';
import { Ic } from '../ui/Icons.jsx';
import { renderPdfPage, renderPdfPages } from '../../lib/pdfUtils.js';
import { resolveDriveFolder, browseDriveFolder, downloadDrivePlan, fmtDriveSize } from '../../lib/drivePlans.js';
import PdfPagePicker from './PdfPagePicker.jsx';

export default function PlanLibraryModal({ planLibrary, onAdd, onDelete, onRename, onRepairBg, onClose, projetNom = '' }) {
  const [rendering, setRendering] = useState(false);
  const [renderProgress, setRenderProgress] = useState('');
  const [renderErr, setRenderErr] = useState(null);
  const [showPicker, setShowPicker] = useState(false);
  const [pdfList, setPdfList] = useState([]); // [{pdf, nom}] — tous les PDF d'un même import
  const [editingId, setEditingId] = useState(null);
  const [editingNom, setEditingNom] = useState('');
  const [previewBg, setPreviewBg] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const [repairTargetId, setRepairTargetId] = useState(null);
  const [repairPdfData, setRepairPdfData] = useState(null);
  const [showRepairPicker, setShowRepairPicker] = useState(false);
  const [repairingId, setRepairingId] = useState(null);
  const fileRef = useRef();
  const repairFileRef = useRef();
  // ── Drive de l'affaire : NAVIGATION niveau par niveau, comme dans le Drive
  //    (1_GESTION, 2_DOCUMENTS_RECUS…) — demande Thomas. drivePath = fil d'Ariane. ──
  const [driveOpen, setDriveOpen] = useState(false);
  const [driveLoading, setDriveLoading] = useState(false);
  const [drivePath, setDrivePath] = useState([]); // [{ id, name }] — racine = dossier affaire
  const [driveContent, setDriveContent] = useState(null); // { folders, files } du niveau courant
  const [driveErr, setDriveErr] = useState(null);
  const [driveDl, setDriveDl] = useState(null); // { id, pct } — téléchargement en cours
  const driveIdRef = useRef(null);

  const browseTo = async (path) => {
    setDriveLoading(true); setDriveErr(null);
    try {
      const content = await browseDriveFolder(path[path.length - 1].id, driveIdRef.current);
      setDrivePath(path);
      setDriveContent(content);
    } catch (e) { setDriveErr(e.message); }
    setDriveLoading(false);
  };

  const openDrive = async () => {
    setDriveOpen(true);
    if (driveContent != null) return; // déjà chargé
    setDriveLoading(true); setDriveErr(null);
    try {
      const { folderId, folderName, driveId } = await resolveDriveFolder(projetNom);
      if (!folderId) {
        setDriveErr(`Dossier introuvable dans le Drive pour « ${projetNom} » — le nom du projet doit contenir le numéro d'affaire.`);
        setDriveLoading(false);
        return;
      }
      driveIdRef.current = driveId || null;
      await browseTo([{ id: folderId, name: folderName }]);
    } catch (e) { setDriveErr(e.message); setDriveLoading(false); }
  };

  const pickDriveFile = async (f) => {
    if (driveDl) return;
    setDriveErr(null);
    setDriveDl({ id: f.id, pct: 0 });
    try {
      const dataUrl = await downloadDrivePlan(f.id, (got, total) => setDriveDl({ id: f.id, pct: total ? Math.round(got / total * 100) : 0 }));
      setDriveDl(null);
      setDriveOpen(false);
      // Rejoint le flux d'import existant : sélecteur de pages puis rendu.
      setPdfList([{ pdf: dataUrl, nom: f.name.replace(/\.[^.]+$/, '') }]);
      setShowPicker(true);
    } catch (e) {
      setDriveDl(null);
      setDriveErr(`Téléchargement impossible : ${e.message}`);
    }
  };

  // Traite une liste de fichiers (input OU glisser-déposer) : images ajoutées directement,
  // PDF regroupés dans UN seul sélecteur de pages (tous les PDF d'un import à la fois).
  const processFiles = (fileList) => {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    setRenderErr(null);

    const pdfs = [], images = [], bad = [];
    for (const f of files) {
      if (f.size > 20 * 1024 * 1024) { bad.push(f.name); continue; }
      if (f.type === 'application/pdf') pdfs.push(f);
      else if (f.type.startsWith('image/')) images.push(f);
      else bad.push(f.name);
    }
    if (bad.length) setRenderErr(`Ignoré(s) — trop volumineux ou format non supporté : ${bad.join(', ')}`);

    images.forEach(f => {
      const nom = f.name.replace(/\.[^.]+$/, '');
      const r = new FileReader();
      r.onload = ev => onAdd([{ id: crypto.randomUUID(), nom, bg: ev.target.result, data: null }]);
      r.readAsDataURL(f);
    });

    if (pdfs.length > 0) {
      Promise.all(pdfs.map(f => new Promise(res => {
        const nom = f.name.replace(/\.[^.]+$/, '');
        const r = new FileReader();
        r.onload = ev => res({ pdf: ev.target.result, nom });
        r.readAsDataURL(f);
      }))).then(list => {
        setPdfList(list);
        setShowPicker(true);
      });
    }
  };

  const handleFile = e => { processFiles(e.target.files); e.target.value = ''; };

  const onDrop = e => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer?.files?.length) processFiles(e.dataTransfer.files);
  };

  // Appelé par le picker MULTI avec [{ nom, pdf, nums:[...] }] — on rend toutes les pages
  // sélectionnées de tous les PDF, puis on ajoute tout d'un coup à la bibliothèque.
  const handlePagesSelected = async (result) => {
    setShowPicker(false);
    setRendering(true);
    setRenderErr(null);
    const totalCount = result.reduce((s, d) => s + d.nums.length, 0);
    const onlyOne = totalCount === 1;
    const allResults = [];
    let done = 0;
    try {
      for (const doc of result) {
        const rendered = await renderPdfPages(doc.pdf, doc.nums, {
          onProgress: (d, t) => setRenderProgress(`Rendu ${done + d} / ${totalCount} page${totalCount > 1 ? 's' : ''}…`),
        });
        // Image HD par page (6500 px) EN PLUS de l'aperçu : c'est elle qui part dans
        // Supabase Storage (hdCandidates de saveRemote) et qui rend la consultation
        // NETTE au zoom. Avant, ce chemin d'import ne générait AUCUNE HD → plans
        // pixelisés dès que la session d'import était fermée (retour Thomas).
        const renderedHd = await renderPdfPages(doc.pdf, doc.nums, {
          maxScale: 10.0, maxWidth: 6500, quality: 0.85, concurrency: 2,
          onProgress: (d) => setRenderProgress(`Haute définition ${done + d} / ${totalCount}…`),
        });
        const hdByNum = new Map(renderedHd.map(r => [r.num, r.img]));
        for (const { num, img } of rendered) {
          if (!img) continue;
          const nom = (onlyOne || doc.nums.length === 1) ? doc.nom : `${doc.nom} — Page ${num}`;
          allResults.push({ id: crypto.randomUUID(), nom, bg: img, hd: hdByNum.get(num) || null, data: doc.pdf });
        }
        done += doc.nums.length;
      }
    } catch (e) {
      setRenderErr('Erreur rendu PDF : ' + e.message);
    }
    setRenderProgress('');
    setRendering(false);
    if (allResults.length > 0) onAdd(allResults);
    else if (!renderErr) setRenderErr("Aucune page n'a pu être rendue.");
    setPdfList([]);
  };

  const startRename = (pl) => {
    setEditingId(pl.id);
    setEditingNom(pl.nom);
  };

  const confirmRename = () => {
    if (editingNom.trim() && onRename) onRename(editingId, editingNom.trim());
    setEditingId(null);
    setEditingNom('');
  };

  const handleRepairFile = e => {
    const f = e.target.files?.[0];
    if (!f || !repairTargetId) return;
    e.target.value = '';
    setRenderErr(null);
    if (f.type === 'application/pdf') {
      const r = new FileReader();
      r.onload = ev => { setRepairPdfData(ev.target.result); setShowRepairPicker(true); };
      r.readAsDataURL(f);
    } else if (f.type.startsWith('image/')) {
      const r = new FileReader();
      r.onload = ev => { onRepairBg(repairTargetId, ev.target.result); setRepairTargetId(null); };
      r.readAsDataURL(f);
    } else {
      setRenderErr('Format non supporté. Utilisez PDF, JPG ou PNG.');
      setRepairTargetId(null);
    }
  };

  const handleRepairPageSelected = async selectedNums => {
    setShowRepairPicker(false);
    const pageNum = selectedNums[0];
    if (!pageNum || !repairPdfData || !repairTargetId) return;
    setRepairingId(repairTargetId);
    try {
      const img = await renderPdfPage(repairPdfData, pageNum);
      if (img) onRepairBg(repairTargetId, img);
      else setRenderErr("Impossible de rendre cette page.");
    } catch (err) {
      setRenderErr('Erreur rendu : ' + err.message);
    }
    setRepairingId(null);
    setRepairTargetId(null);
    setRepairPdfData(null);
  };

  if (showRepairPicker && repairPdfData) return (
    <PdfPagePicker
      pdfData={repairPdfData}
      label="Choisir la page du plan"
      onSelectMany={handleRepairPageSelected}
      onClose={() => { setShowRepairPicker(false); setRepairTargetId(null); setRepairPdfData(null); }}
    />
  );

  if (showPicker && pdfList.length > 0) return (
    <PdfPagePicker
      pdfs={pdfList}
      label={pdfList.length === 1 ? pdfList[0].nom : null}
      onSelectMany={handlePagesSelected}
      onClose={() => { setShowPicker(false); setPdfList([]); }}
    />
  );

  if (previewBg) return (
    <div onClick={() => setPreviewBg(null)} style={{ position:'fixed',inset:0,background:'rgba(0,0,0,0.92)',zIndex:80,display:'flex',alignItems:'center',justifyContent:'center',cursor:'zoom-out' }}>
      <img src={previewBg} alt="" style={{ maxWidth:'92vw',maxHeight:'92vh',objectFit:'contain',borderRadius:8,boxShadow:'0 8px 40px rgba(0,0,0,0.6)' }}/>
      <button onClick={() => setPreviewBg(null)} style={{ position:'absolute',top:16,right:16,background:'rgba(255,255,255,0.12)',border:'none',color:'white',borderRadius:'50%',width:36,height:36,display:'flex',alignItems:'center',justifyContent:'center',cursor:'pointer' }}>
        <Ic n="x" s={16}/>
      </button>
    </div>
  );

  return (
    <div className="modal-overlay" style={{ zIndex:60 }}>
      <div className="modal-sheet-flex">
        {/* Header */}
        <div style={{ padding:'16px 18px 14px',borderBottom:`1px solid ${DA.border}`,flexShrink:0 }}>
          <div style={{ display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:4 }}>
            <div style={{ display:'flex',alignItems:'center',gap:8 }}>
              <Ic n="lib" s={18}/>
              <p style={{ fontWeight:800,fontSize:15,color:DA.black,margin:0 }}>Bibliothèque de plans</p>
            </div>
            <button onClick={onClose} style={{ background:'none',border:'none',cursor:'pointer',color:DA.grayL }}><Ic n="x" s={20}/></button>
          </div>
          <p style={{ fontSize:12,color:DA.gray,margin:0 }}>Importez votre PDF — choisissez les pages à garder.</p>
        </div>

        {/* Corps */}
        <div style={{ flex:1,overflowY:'auto',padding:14 }}>
          {/* Grande zone d'import : glisser-déposer OU clic pour parcourir les fichiers */}
          <div
            onClick={() => !rendering && fileRef.current.click()}
            onDragOver={e => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={e => { e.preventDefault(); setDragOver(false); }}
            onDrop={onDrop}
            style={{
              display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:6,
              padding:'22px 16px', marginBottom:14, borderRadius:14, textAlign:'center',
              border:`2px dashed ${dragOver ? DA.red : '#C9CDD2'}`,
              background: dragOver ? DA.redL : '#FAFBFC',
              cursor: rendering ? 'default' : 'pointer', transition:'all 0.12s', userSelect:'none',
            }}>
            <div style={{ width:42, height:42, borderRadius:'50%', background: dragOver ? DA.red : '#EEF0F2', display:'flex', alignItems:'center', justifyContent:'center', color: dragOver ? 'white' : DA.gray }}>
              <Ic n="plus" s={22}/>
            </div>
            <p style={{ fontSize:14, fontWeight:800, color:DA.black, margin:'2px 0 0' }}>
              Glissez vos plans ici
            </p>
            <p style={{ fontSize:12, color:DA.gray, margin:0 }}>
              ou <span style={{ color:DA.red, fontWeight:700 }}>cliquez pour parcourir</span> — PDF, JPG, PNG · plusieurs fichiers à la fois
            </p>
          </div>
          <input ref={fileRef} type="file" accept="image/*,application/pdf" multiple style={{ display:'none' }} onChange={handleFile}/>
          <input ref={repairFileRef} type="file" accept="image/*,application/pdf" style={{ display:'none' }} onChange={handleRepairFile}/>

          {/* ── Drive de l'affaire : les PDF du dossier de l'affaire, sans chercher dans le Drive ── */}
          <div style={{ marginBottom:14 }}>
            <button onClick={() => driveOpen ? setDriveOpen(false) : openDrive()}
              style={{ width:'100%', display:'flex', alignItems:'center', gap:10, padding:'12px 14px', borderRadius:12,
                border:`1.5px solid ${driveOpen ? DA.red : DA.border}`, background:'white', cursor:'pointer', textAlign:'left' }}>
              <span style={{ fontSize:17, flexShrink:0 }}>📁</span>
              <span style={{ flex:1, minWidth:0 }}>
                <span style={{ display:'block', fontSize:13, fontWeight:800, color:DA.black }}>Drive de l'affaire</span>
                <span style={{ display:'block', fontSize:11, color:DA.grayL, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                  {drivePath.length ? `Dossier : ${drivePath[0].name}` : 'Se balader dans le dossier du projet, comme dans le Drive'}
                </span>
              </span>
              <span style={{ flexShrink:0, fontSize:11, color:DA.grayL }}>{driveOpen ? '▴' : '▾'}</span>
            </button>
            {driveOpen && (
              <div style={{ border:`1px solid ${DA.border}`, borderTop:'none', borderRadius:'0 0 12px 12px', margin:'0 6px', background:'#FAFBFC', maxHeight:340, overflowY:'auto' }}>
                {/* Fil d'Ariane : ‹ remonte d'un niveau, le chemin est cliquable */}
                {drivePath.length > 0 && (
                  <div style={{ display:'flex', alignItems:'center', gap:6, padding:'8px 10px', borderBottom:`1px solid ${DA.grayXL}`, position:'sticky', top:0, background:'#FAFBFC', zIndex:1 }}>
                    {drivePath.length > 1 && (
                      <button onClick={() => browseTo(drivePath.slice(0, -1))} disabled={driveLoading}
                        title="Remonter d'un niveau"
                        style={{ flexShrink:0, width:30, height:30, borderRadius:8, border:`1px solid ${DA.border}`, background:'white', color:DA.gray, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', fontSize:15, fontWeight:800 }}>
                        ‹
                      </button>
                    )}
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
                {/* Sous-dossiers d'abord (comme dans le Drive), puis les PDF du niveau courant */}
                {!driveLoading && (driveContent?.folders || []).map(f => (
                  <button key={f.id} onClick={() => browseTo([...drivePath, f])} disabled={!!driveDl}
                    style={{ width:'100%', display:'flex', alignItems:'center', gap:9, padding:'10px 14px', background:'none',
                      border:'none', borderTop:`1px solid ${DA.grayXL}`, cursor: driveDl ? 'default' : 'pointer', textAlign:'left' }}>
                    <span style={{ fontSize:15, flexShrink:0 }}>📁</span>
                    <span style={{ flex:1, minWidth:0, fontSize:12.5, fontWeight:700, color:DA.black, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{f.name}</span>
                    <span style={{ flexShrink:0, color:DA.grayL, fontSize:14 }}>›</span>
                  </button>
                ))}
                {!driveLoading && (driveContent?.files || []).map(f => {
                  const dl = driveDl?.id === f.id;
                  const tooBig = f.size > 60 * 1024 * 1024;
                  return (
                    <button key={f.id} onClick={() => !tooBig && pickDriveFile(f)} disabled={!!driveDl || tooBig}
                      style={{ width:'100%', display:'flex', alignItems:'center', gap:9, padding:'9px 14px', background:'none',
                        border:'none', borderTop:`1px solid ${DA.grayXL}`, cursor: (driveDl || tooBig) ? 'default' : 'pointer',
                        textAlign:'left', opacity: tooBig ? 0.45 : driveDl && !dl ? 0.5 : 1 }}>
                      <span style={{ fontSize:13, flexShrink:0 }}>📄</span>
                      <span style={{ flex:1, minWidth:0 }}>
                        <span style={{ display:'block', fontSize:12, fontWeight:700, color:DA.black, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{f.name}</span>
                        <span style={{ display:'block', fontSize:10.5, color:DA.grayL }}>
                          {[fmtDriveSize(f.size), tooBig ? 'trop volumineux (max 60 Mo)' : null].filter(Boolean).join(' · ')}
                        </span>
                      </span>
                      {dl && <span style={{ flexShrink:0, fontSize:11, fontWeight:800, color:DA.red, display:'flex', alignItems:'center', gap:5 }}><Ic n="spn" s={12}/> {driveDl.pct} %</span>}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {renderErr && (
            <div style={{ background:'#FFF0F0',border:'1px solid #FCA5A5',borderRadius:8,padding:'10px 12px',marginBottom:12,fontSize:12,color:'#B91C1C' }}>
              ⚠️ {renderErr}
            </div>
          )}
          {rendering && (
            <div style={{ display:'flex',alignItems:'center',gap:8,padding:'16px 0',color:DA.gray,justifyContent:'center' }}>
              <Ic n="spn" s={20}/><span style={{ fontSize:13 }}>{renderProgress || 'Rendu en cours…'}</span>
            </div>
          )}
          {planLibrary.length === 0 && !rendering && (
            <div style={{ textAlign:'center',padding:'32px 0',color:DA.grayL }}>
              <Ic n="map" s={40}/>
              <p style={{ fontSize:13,fontWeight:600,color:DA.gray,margin:'8px 0 4px' }}>Aucun plan dans la bibliothèque</p>
              <p style={{ fontSize:11,color:DA.grayL,margin:0 }}>Importez vos PDF ou images de plans</p>
            </div>
          )}
          <div style={{ display:'flex',flexDirection:'column',gap:10 }}>
            {planLibrary.map(pl => (
              <div key={pl.id} style={{ display:'flex',alignItems:'center',gap:10,padding:'10px 12px',borderRadius:12,border:`1px solid ${pl.bg ? DA.border : '#FCA5A5'}`,background:DA.white }}>
                {pl.bg
                  ? <img src={pl.bg} alt="" onClick={() => setPreviewBg(pl.bg)} style={{ width:64,height:44,objectFit:'cover',borderRadius:6,border:`1px solid ${DA.border}`,flexShrink:0,cursor:'zoom-in' }}/>
                  : <div style={{ width:64,height:44,borderRadius:6,border:`1px dashed #FCA5A5`,flexShrink:0,background:'#FFF8F8',display:'flex',alignItems:'center',justifyContent:'center' }}><Ic n="img" s={18}/></div>
                }
                <div style={{ flex:1,minWidth:0 }}>
                  {editingId === pl.id ? (
                    <input
                      autoFocus
                      value={editingNom}
                      onChange={e => setEditingNom(e.target.value)}
                      onBlur={confirmRename}
                      onKeyDown={e => { if (e.key==='Enter') confirmRename(); if (e.key==='Escape') setEditingId(null); }}
                      style={{ width:'100%',fontSize:13,fontWeight:700,border:`1px solid ${DA.red}`,borderRadius:6,padding:'3px 6px',outline:'none',boxSizing:'border-box' }}
                    />
                  ) : (
                    <p style={{ fontWeight:700,fontSize:13,color:DA.black,margin:0,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap' }}>{pl.nom}</p>
                  )}
                  <p style={{ fontSize:10,color:DA.grayL,margin:'2px 0 0' }}>{pl.data ? 'Document PDF' : 'Image'}</p>
                </div>
                <div style={{ display:'flex',gap:4,flexShrink:0,alignItems:'center' }}>
                  {!pl.bg && onRepairBg && (
                    <button
                      onClick={() => { setRepairTargetId(pl.id); repairFileRef.current.click(); }}
                      disabled={repairingId === pl.id}
                      title="Réimporter l'image de ce plan (sans perdre les zones)"
                      style={{ padding:'4px 7px',color:'#B91C1C',background:'#FFF0F0',border:'1px solid #FCA5A5',borderRadius:6,cursor:'pointer',display:'flex',alignItems:'center',gap:3,fontSize:10,fontWeight:700,whiteSpace:'nowrap' }}>
                      {repairingId === pl.id ? <Ic n="spn" s={12}/> : <Ic n="und" s={12}/>}
                      Réimporter
                    </button>
                  )}
                  {onRename && (
                    <button onClick={() => startRename(pl)}
                      style={{ padding:6,color:'#ccc',background:'none',border:'none',cursor:'pointer' }}
                      onMouseEnter={e=>e.currentTarget.style.color=DA.black} onMouseLeave={e=>e.currentTarget.style.color='#ccc'}>
                      <Ic n="pen" s={14}/>
                    </button>
                  )}
                  <button onClick={() => onDelete(pl.id)}
                    style={{ padding:6,color:'#ccc',background:'none',border:'none',cursor:'pointer' }}
                    onMouseEnter={e=>e.currentTarget.style.color=DA.red} onMouseLeave={e=>e.currentTarget.style.color='#ccc'}>
                    <Ic n="del" s={15}/>
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div style={{ padding:'12px 14px 20px',borderTop:`1px solid ${DA.border}`,flexShrink:0 }}>
          <button onClick={onClose}
            style={{ width:'100%',background:DA.red,color:'white',border:'none',borderRadius:12,padding:14,fontSize:14,fontWeight:700,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',gap:6 }}>
            <Ic n="chk" s={15}/> Terminer
          </button>
        </div>
      </div>
    </div>
  );
}
