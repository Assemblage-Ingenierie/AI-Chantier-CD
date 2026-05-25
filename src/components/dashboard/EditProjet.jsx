import React, { useState, useRef } from 'react';
import { DA } from '../../lib/constants.js';
import { Ic } from '../ui/Icons.jsx';
import CropTool from '../ui/CropTool.jsx';

const FIELDS = [
  { k: 'nom',          l: 'Nom du projet *',  ph: 'Ex: Résidence Les Acacias'     },
  { k: 'maitreOuvrage',l: "Maître d'ouvrage", ph: 'Ex: Ville de Lyon, M. Dupont…' },
  { k: 'adresse',      l: 'Adresse',          ph: 'Ex: 12 rue des Acacias, Lyon'  },
];

export default function EditProjet({ projet, onClose, onSave }) {
  const [f,        setF]        = useState({ nom: projet.nom || '', adresse: projet.adresse || '', photo: projet.photo || null, maitreOuvrage: projet.maitreOuvrage || '' });
  const [rawPhoto, setRawPhoto] = useState(null);
  const fileRef = useRef();

  const handleFile = (file) => {
    if (!file) return;
    if (file.size > 25 * 1024 * 1024) { alert('Image trop grande (max 25 Mo)'); return; }
    setRawPhoto(URL.createObjectURL(file));
  };

  const handleCropDone = (dataUrl) => {
    if (rawPhoto?.startsWith('blob:')) URL.revokeObjectURL(rawPhoto);
    setRawPhoto(null);
    setF(p => ({ ...p, photo: dataUrl }));
  };

  const handleCropCancel = () => {
    if (rawPhoto?.startsWith('blob:')) URL.revokeObjectURL(rawPhoto);
    setRawPhoto(null);
  };

  if (rawPhoto) return (
    <div className="modal-overlay">
      <div className="modal-sheet" style={{ padding:20 }}>
        <div style={{ display:'flex', justifyContent:'space-between', marginBottom:14 }}>
          <p style={{ fontWeight:800, fontSize:15, color:DA.black, margin:0 }}>Cadrer la photo</p>
          <button onClick={handleCropCancel} style={{ background:'none', border:'none', cursor:'pointer', color:DA.grayL }}><Ic n="x" s={20}/></button>
        </div>
        <CropTool src={rawPhoto} onDone={handleCropDone} onCancel={handleCropCancel}/>
      </div>
    </div>
  );

  return (
    <div className="modal-overlay">
      <div className="modal-sheet" style={{ padding:20 }}>
        <div style={{ display:'flex', justifyContent:'space-between', marginBottom:16 }}>
          <p style={{ fontWeight:800, fontSize:15, color:DA.black, margin:0 }}>Modifier le projet</p>
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
                <p style={{ fontSize:11, color:DA.grayL, marginTop:6, marginBottom:0 }}>Appuyer pour prendre une photo</p>
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
            <button onClick={e => { e.stopPropagation(); setRawPhoto(f.photo); }}
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
          style={{ width:'100%', background: f.nom ? DA.red : '#ccc', color:'white', border:'none', borderRadius:12, padding:13, fontSize:14, fontWeight:800, cursor: f.nom ? 'pointer' : 'not-allowed', marginTop:4, display:'flex', alignItems:'center', justifyContent:'center', gap:6 }}>
          <Ic n="chk" s={15}/> Enregistrer
        </button>
      </div>
    </div>
  );
}
