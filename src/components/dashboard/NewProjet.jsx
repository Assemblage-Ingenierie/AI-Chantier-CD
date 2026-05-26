import React, { useState, useRef, useEffect } from 'react';
import { DA } from '../../lib/constants.js';
import { Ic } from '../ui/Icons.jsx';
import CropTool from '../ui/CropTool.jsx';

const FIELDS = [
  { k: 'nom',          l: 'Nom du projet *',  ph: 'Ex: Résidence Les Acacias'     },
  { k: 'maitreOuvrage',l: "Maître d'ouvrage", ph: 'Ex: Ville de Lyon, M. Dupont…' },
  { k: 'adresse',      l: 'Adresse',          ph: 'Ex: 12 rue des Acacias, Lyon'  },
];

const RATIO_TUILE = 16 / 9;
const RATIO_GARDE = 210 / 85;

export default function NewProjet({ onClose, onSave }) {
  const [f,        setF]       = useState({ nom:'', adresse:'', photo:null, photoCouverture:null, maitreOuvrage:'' });
  const [cropSrc,  setCropSrc] = useState(null);
  const [cropStep, setCropStep] = useState(null); // 'tuile' | 'garde'
  const fileRef = useRef();
  const originalSrcRef = useRef(null);

  useEffect(() => () => { if (originalSrcRef.current) URL.revokeObjectURL(originalSrcRef.current); }, []);

  const handleFile = (file) => {
    if (!file) return;
    if (file.size > 25 * 1024 * 1024) { alert('Image trop grande (max 25 Mo)'); return; }
    if (originalSrcRef.current) URL.revokeObjectURL(originalSrcRef.current);
    const blob = URL.createObjectURL(file);
    originalSrcRef.current = blob;
    setCropSrc(blob);
    setCropStep('tuile');
  };

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
                <Ic n="cam" s={28}/>
                <p style={{ fontSize:11, color:DA.grayL, marginTop:6, marginBottom:0 }}>Appuyer pour ajouter une photo</p>
              </div>
            )}
          </div>
        </div>

        <div style={{ display:'flex', gap:6, marginBottom:16 }}>
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

        <input ref={fileRef} type="file" accept="image/*" style={{ display:'none' }}
          onChange={e => { const file = e.target.files?.[0]; if (file) handleFile(file); e.target.value = ''; }}/>

        {FIELDS.map(({ k, l, ph }) => (
          <div key={k} style={{ marginBottom:12 }}>
            <label style={{ display:'block', fontSize:11, fontWeight:700, color:DA.gray, marginBottom:5, textTransform:'uppercase', letterSpacing:0.5 }}>{l}</label>
            <input value={f[k]} onChange={e => setF(x => ({ ...x, [k]: e.target.value }))} placeholder={ph}
              style={{ width:'100%', border:`1px solid ${DA.border}`, borderRadius:8, padding:'10px 12px', fontSize:13, outline:'none', boxSizing:'border-box' }}
              onFocus={e => e.target.style.borderColor = DA.red}
              onBlur={e  => e.target.style.borderColor = DA.border}/>
          </div>
        ))}

        <button onClick={() => { onSave(f); onClose(); }} disabled={!f.nom}
          style={{ width:'100%', background: f.nom ? DA.black : '#ccc', color:'white', border:'none', borderRadius:12, padding:13, fontSize:14, fontWeight:800, cursor: f.nom ? 'pointer' : 'not-allowed', marginTop:4 }}>
          Créer le projet
        </button>
      </div>
    </div>
  );
}
