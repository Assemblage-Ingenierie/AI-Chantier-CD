import React, { useEffect, useRef, useState } from 'react';
import { DA } from '../../lib/constants.js';
import { buildVisitProjet } from '../../lib/visitProjet.js';
import RapportTab from '../vue/RapportTab.jsx';

// EXPORT GROUPÉ « tous les rapports de visite » en un zip (PC — demande Thomas 15/10/2026).
// Pour chaque visite : photos chargées, onglet Rapport rendu HORS ÉCRAN (en lecture seule), puis
// toPdfBlob() de l'aperçu → PDF identique à l'aperçu. Rien n'est modifié dans le projet.
const sanitize = (s) => String(s || '').replace(/[^a-zA-Z0-9À-ÿ _().-]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 70);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const noop = () => {};

export default function BulkReportExport({ projet, onHydrateVisite, onClose }) {
  const visites = projet.visites || [];
  const [current, setCurrent] = useState(null);   // visite rendue hors écran
  const [step, setStep] = useState({ i: 0, label: 'Préparation…' });
  const [result, setResult] = useState(null);     // { ok, n, failed: [] } | { error }
  const projRef = useRef(projet); projRef.current = projet;
  const exportRef = useRef(null);
  const hostRef = useRef(null);
  const renderedRef = useRef(null);               // résout quand la visite courante est montée
  const cancelRef = useRef(false);

  useEffect(() => { if (renderedRef.current && current) { renderedRef.current(); renderedRef.current = null; } }, [current]);

  useEffect(() => {
    cancelRef.current = false;
    (async () => {
      const failed = [];
      const files = [];
      for (let i = 0; i < visites.length; i++) {
        if (cancelRef.current) return;
        const v0 = visites[i];
        const name = v0.label || `Visite ${i + 1}`;
        setStep({ i: i + 1, label: `Rapport ${i + 1}/${visites.length} : ${name}` });
        try {
          // 1) Photos de la visite (chargées à la demande dans l'app) — attente bornée.
          try { await onHydrateVisite?.(v0.id); } catch { /* hors ligne : on exporte ce qu'on a */ }
          for (let t = 0; t < 40; t++) {
            const v = (projRef.current.visites || []).find(x => x.id === v0.id);
            const items = (v?.localisations || []).flatMap(l => l.items || []);
            if (items.every(it => it._photosHydrated)) break; // hors ligne : délai dépassé → on exporte l'état connu
            await sleep(150);
          }
          // 2) Rendu hors écran de l'onglet Rapport pour cette visite.
          const v = (projRef.current.visites || []).find(x => x.id === v0.id) || v0;
          await new Promise(res => { renderedRef.current = res; setCurrent({ key: `${v.id}-${i}`, projet: buildVisitProjet(projRef.current, v) }); });
          // Laisse l'aperçu se mettre en page (plans dessinés sur canvas, images, polices).
          await sleep(1200);
          for (let t = 0; t < 30; t++) {
            const imgs = Array.from(hostRef.current?.querySelectorAll('img') || []);
            if (imgs.every(im => im.complete)) break;
            await sleep(200);
          }
          await sleep(600);
          if (cancelRef.current) return;
          const blob = await exportRef.current?.toPdfBlob?.();
          if (!blob) throw new Error('rapport vide');
          const date = v.dateVisite ? `_${String(v.dateVisite).replace(/-/g, '_')}` : '';
          files.push({ name: `${String(i + 1).padStart(2, '0')}_${sanitize(name)}${date}.pdf`, blob });
        } catch (e) {
          console.warn('[Export zip] rapport non généré :', name, e);
          failed.push(`${name} (${e?.message || 'erreur'})`);
        }
      }
      setCurrent(null);
      if (cancelRef.current) return;
      if (!files.length) { setResult({ error: 'Aucun rapport n\'a pu être généré.', failed }); return; }
      setStep({ i: visites.length, label: 'Création du zip…' });
      const { default: JSZip } = await import('jszip');
      const zip = new JSZip();
      files.forEach(f => zip.file(f.name, f.blob));
      const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE' }); // PDF déjà compressés
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `${sanitize(projet.nom || 'Projet')}_rapports_de_visite.zip`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      setResult({ ok: true, n: files.length, failed });
    })();
    return () => { cancelRef.current = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const pct = visites.length ? Math.round(((result ? visites.length : Math.max(0, step.i - 1)) / visites.length) * 100) : 0;
  return (
    <>
      {/* Rendu hors écran (jamais visible, jamais interactif) */}
      <div ref={hostRef} aria-hidden="true" style={{ position:'fixed', left:-30000, top:0, width:1280, height:1600, overflow:'hidden', pointerEvents:'none', zIndex:-1 }}>
        {current && <RapportTab key={current.key} projet={current.projet} onUpdate={noop} exportRef={exportRef}/>}
      </div>

      <div style={{ position:'fixed', inset:0, zIndex:500, background:'rgba(0,0,0,0.35)', display:'flex', alignItems:'center', justifyContent:'center' }}>
        <div role="dialog" aria-label="Export des rapports" style={{ width:420, maxWidth:'calc(100vw - 32px)', background:'white', borderRadius:14, padding:'18px 20px', boxShadow:'0 12px 40px rgba(0,0,0,0.25)' }}>
          <div style={{ fontWeight:800, fontSize:15, color:DA.black }}>Télécharger tous les rapports</div>
          {!result && (
            <>
              <div style={{ marginTop:10, fontSize:13, color:DA.gray }}>{step.label}</div>
              <div style={{ marginTop:10, height:8, borderRadius:4, background:DA.grayXL, overflow:'hidden' }}>
                <div style={{ width:`${pct}%`, height:'100%', background:DA.red, transition:'width 0.3s' }}/>
              </div>
              <div style={{ marginTop:8, fontSize:11.5, color:DA.grayL }}>Chaque rapport est généré comme son aperçu (≈ 10 à 30 s par visite). Garde cet onglet ouvert.</div>
              <button onClick={() => { cancelRef.current = true; onClose(); }}
                style={{ marginTop:14, padding:'7px 14px', borderRadius:8, border:`1px solid ${DA.border}`, background:'white', color:DA.gray, fontSize:12.5, fontWeight:700, cursor:'pointer' }}>Annuler</button>
            </>
          )}
          {result && (
            <>
              <div style={{ marginTop:10, fontSize:13, color: result.ok ? DA.black : '#B91C1C', lineHeight:1.5 }}>
                {result.ok ? `✓ ${result.n} rapport${result.n > 1 ? 's' : ''} dans le zip téléchargé.` : result.error}
              </div>
              {result.failed?.length > 0 && (
                <div style={{ marginTop:6, fontSize:12, color:'#B91C1C', lineHeight:1.45 }}>Non générés : {result.failed.join(' ; ')}</div>
              )}
              <button onClick={onClose}
                style={{ marginTop:14, padding:'7px 14px', borderRadius:8, border:'none', background:DA.red, color:'white', fontSize:12.5, fontWeight:800, cursor:'pointer' }}>Fermer</button>
            </>
          )}
        </div>
      </div>
    </>
  );
}
