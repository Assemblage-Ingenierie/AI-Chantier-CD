import React, { useState, useRef, useEffect } from 'react';
import { DA } from '../../lib/constants.js';
import { Ic } from '../ui/Icons.jsx';
import CropTool from '../ui/CropTool.jsx';
import IngenieursEditor from '../ui/IngenieursEditor.jsx';
import { pdfFileToImageDataUrl } from '../../lib/pdfUtils.js';

const FIELDS = [
  { k: 'nom',          l: 'Nom du projet *',  ph: 'Ex: Résidence Les Acacias'     },
  { k: 'maitreOuvrage',l: "Maître d'ouvrage", ph: 'Ex: Ville de Lyon, M. Dupont…' },
  { k: 'adresse',      l: 'Adresse',          ph: 'Ex: 12 rue des Acacias, Lyon'  },
];

const RATIO_TUILE = 16 / 9;
const RATIO_GARDE = 210 / 85;

// Touche clavier stylisée pour l'astuce Ctrl+V.
const Kbd = ({ children }) => (
  <span style={{ display:'inline-block', border:`1px solid ${DA.border}`, borderBottomWidth:2, borderRadius:4,
    padding:'0 5px', fontSize:10, fontWeight:700, color:DA.gray, background:'white', lineHeight:'16px' }}>{children}</span>
);

// Astuce visible en permanence : les collègues doivent SAVOIR qu'un PDF (page de garde…)
// ou une capture d'écran collée fonctionnent comme source de couverture (demande Thomas).
export const CoverSourcesHint = () => (
  <div style={{ display:'flex', alignItems:'flex-start', gap:8, background:DA.grayXL,
    border:`1px solid ${DA.border}`, borderRadius:9, padding:'8px 11px', marginBottom:14 }}>
    <span style={{ fontSize:14, lineHeight:'18px' }}>💡</span>
    <p style={{ fontSize:11.5, color:DA.gray, margin:0, lineHeight:1.5 }}>
      Fonctionne avec une <b>photo</b>, un <b>PDF</b> (sa 1<sup>re</sup> page, ex : page de garde)
      ou une <b>capture d'écran collée</b> directement ici — <Kbd>Ctrl</Kbd>+<Kbd>V</Kbd> sur PC.
    </p>
  </div>
);

export default function NewProjet({ onClose, onSave }) {
  const [f,        setF]       = useState({ nom:'', adresse:'', photo:null, photoCouverture:null, maitreOuvrage:'', ingenieurs:'' });
  const [cropSrc,  setCropSrc] = useState(null);
  const [cropStep, setCropStep] = useState(null); // 'tuile' | 'garde'
  const [pdfBusy,  setPdfBusy]  = useState(false); // rendu PDF → image en cours
  const fileRef = useRef();
  const originalSrcRef = useRef(null);

  const releaseOriginal = () => {
    // data URL (PDF rendu) : rien à libérer — seuls les blob: URLs se révoquent.
    if (originalSrcRef.current?.startsWith('blob:')) URL.revokeObjectURL(originalSrcRef.current);
    originalSrcRef.current = null;
  };
  useEffect(() => releaseOriginal, []);

  const handleFile = async (file) => {
    if (!file) return;
    if (file.size > 25 * 1024 * 1024) { alert('Fichier trop grand (max 25 Mo)'); return; }
    let src;
    if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name || '')) {
      // PDF accepté comme source de couverture : on rend la 1re page en image.
      setPdfBusy(true);
      src = await pdfFileToImageDataUrl(file).finally(() => setPdfBusy(false));
      if (!src) { alert('Impossible de lire ce PDF'); return; }
    } else {
      src = URL.createObjectURL(file);
    }
    releaseOriginal();
    originalSrcRef.current = src;
    setCropSrc(src);
    setCropStep('tuile');
  };

  // Coller (Ctrl+V) une capture d'écran — ou un PDF — directement dans la fenêtre (PC).
  useEffect(() => {
    const onPaste = (e) => {
      const item = Array.from(e.clipboardData?.items || [])
        .find(i => i.type.startsWith('image/') || i.type === 'application/pdf');
      const file = item?.getAsFile();
      if (file) { e.preventDefault(); handleFile(file); }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleTuileDone = (dataUrl) => {
    setF(p => ({ ...p, photo: dataUrl }));
    setCropStep('garde');
  };

  const handleGardeDone = (dataUrl) => {
    setF(p => ({ ...p, photoCouverture: dataUrl }));
    setCropSrc(null); setCropStep(null);
  };

  const handleCropCancel = () => {
    setCropSrc(null); setCropStep(null);
  };

  if (cropSrc && cropStep) {
    const isTuile = cropStep === 'tuile';
    return (
      <div className="modal-overlay">
        <div className="modal-sheet" style={{ padding:20 }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:14 }}>
            <div>
              <p style={{ fontWeight:800, fontSize:15, color:DA.black, margin:0 }}>
                {isTuile ? 'Cadrer — Tuile (app)' : 'Cadrer — Page de garde (rapport)'}
              </p>
              <p style={{ fontSize:11, color:DA.grayL, margin:'3px 0 0' }}>
                Étape {isTuile ? '1' : '2'} sur 2
              </p>
            </div>
            <button onClick={handleCropCancel} style={{ background:'none', border:'none', cursor:'pointer', color:DA.grayL }}>
              <Ic n="x" s={20}/>
            </button>
          </div>
          <CropTool
            src={cropSrc}
            ratio={isTuile ? RATIO_TUILE : RATIO_GARDE}
            outputWidth={1200}
            outputHeight={isTuile ? 675 : 486}
            cancelLabel={isTuile ? 'Annuler' : 'Passer'}
            onDone={isTuile ? handleTuileDone : handleGardeDone}
            onCancel={handleCropCancel}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="modal-overlay">
      <div className="modal-sheet" style={{ padding:20 }}>
        <div style={{ display:'flex', justifyContent:'space-between', marginBottom:16 }}>
          <p style={{ fontWeight:800, fontSize:15, color:DA.black, margin:0 }}>Nouveau projet</p>
          <button onClick={onClose} style={{ background:'none', border:'none', cursor:'pointer', color:DA.grayL }}><Ic n="x" s={20}/></button>
        </div>

        <div onClick={() => fileRef.current?.click()}
          style={{ position:'relative', width:'100%', paddingTop:'56.25%', borderRadius:12,
            border:`2px dashed ${f.photo ? 'transparent' : DA.border}`,
            overflow:'hidden', background: f.photo ? 'transparent' : DA.grayXL,
            marginBottom:8, cursor:'pointer', boxSizing:'border-box' }}>
          <div style={{ position:'absolute', inset:0, display:'flex', alignItems:'center', justifyContent:'center' }}>
            {f.photo ? (
              <>
                <img src={f.photo} alt="" style={{ position:'absolute', inset:0, width:'100%', height:'100%', objectFit:'cover' }}/>
                <div style={{ position:'absolute', inset:0, background:'rgba(0,0,0,0.28)', display:'flex', alignItems:'center', justifyContent:'center' }}>
                  <span style={{ fontSize:11, color:'white', fontWeight:700, background:'rgba(0,0,0,0.45)', padding:'4px 10px', borderRadius:6 }}>Changer</span>
                </div>
              </>
            ) : (
              <div style={{ textAlign:'center', pointerEvents:'none' }}>
                {pdfBusy ? <Ic n="spn" s={28}/> : <Ic n="cam" s={28}/>}
                <p style={{ fontSize:11, color:DA.grayL, marginTop:6, marginBottom:0 }}>
                  {pdfBusy ? 'Lecture du PDF…' : 'Appuyer pour ajouter une photo ou un PDF'}
                </p>
              </div>
            )}
          </div>
        </div>

        <div style={{ display:'flex', gap:6, marginBottom:10 }}>
          <button onClick={e => { e.stopPropagation(); fileRef.current?.click(); }}
            style={{ border:`1px solid ${DA.border}`, background:'white', borderRadius:7, padding:'5px 12px', fontSize:11, fontWeight:600, cursor:'pointer', display:'flex', alignItems:'center', gap:4, color:DA.gray }}>
            <Ic n="img" s={11}/> Galerie
          </button>
          {f.photo && (
            <button onClick={e => { e.stopPropagation(); setCropSrc(originalSrcRef.current || f.photo); setCropStep('tuile'); }}
              style={{ border:`1px solid ${DA.border}`, background:'white', borderRadius:7, padding:'5px 12px', fontSize:11, fontWeight:600, cursor:'pointer', color:DA.gray }}>
              ✂ Recadrer
            </button>
          )}
        </div>

        <input ref={fileRef} type="file" accept="image/*,application/pdf" style={{ display:'none' }}
          onChange={e => { const file = e.target.files?.[0]; if (file) handleFile(file); e.target.value = ''; }}/>

        <CoverSourcesHint/>

        {FIELDS.map(({ k, l, ph }) => (
          <div key={k} style={{ marginBottom:12 }}>
            <label style={{ display:'block', fontSize:11, fontWeight:700, color:DA.gray, marginBottom:5, textTransform:'uppercase', letterSpacing:0.5 }}>{l}</label>
            <input value={f[k]} onChange={e => setF(x => ({ ...x, [k]: e.target.value }))} placeholder={ph}
              style={{ width:'100%', border:`1px solid ${DA.border}`, borderRadius:8, padding:'10px 12px', fontSize:13, outline:'none', boxSizing:'border-box' }}
              onFocus={e => e.target.style.borderColor = DA.red}
              onBlur={e  => e.target.style.borderColor = DA.border}/>
          </div>
        ))}

        {/* Ingénieurs au niveau du projet : le projet arrive directement dans « Mes projets »
            des initiales listées, indépendamment des ingénieurs de chaque visite. */}
        <div style={{ marginBottom:12 }}>
          <label style={{ display:'block', fontSize:11, fontWeight:700, color:DA.gray, marginBottom:5, textTransform:'uppercase', letterSpacing:0.5 }}>
            Ingénieur(s) du projet
          </label>
          <IngenieursEditor value={f.ingenieurs} onChange={val => setF(x => ({ ...x, ingenieurs: val }))}/>
          <p style={{ fontSize:10, color:DA.grayL, margin:'4px 0 0' }}>Le projet apparaîtra dans « Mes projets » de ces initiales.</p>
        </div>

        <button onClick={() => { onSave(f); onClose(); }} disabled={!f.nom}
          style={{ width:'100%', background: f.nom ? DA.black : '#ccc', color:'white', border:'none', borderRadius:12, padding:13, fontSize:14, fontWeight:800, cursor: f.nom ? 'pointer' : 'not-allowed', marginTop:4 }}>
          Créer le projet
        </button>
      </div>
    </div>
  );
}
