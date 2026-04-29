import React, { useState, useRef } from 'react';
import { DA } from '../../lib/constants.js';
import { Ic } from '../ui/Icons.jsx';

const FIELDS = [
  { k: 'nom', l: 'Nom du projet *', ph: 'Ex: Résidence Les Acacias' },
  { k: 'maitreOuvrage', l: "Maître d'ouvrage", ph: 'Ex: Ville de Lyon, M. Dupont…' },
  { k: 'adresse', l: 'Adresse', ph: 'Ex: 12 rue des Acacias, Lyon' },
];

const compress = (file) => new Promise(res => {
  const r = new FileReader();
  r.onload = ev => {
    const img = new Image();
    img.onload = () => {
      const MAX = 1920;
      let { width, height } = img;
      if (width > MAX || height > MAX) {
        if (width > height) { height = Math.round(height * MAX / width); width = MAX; }
        else { width = Math.round(width * MAX / height); height = MAX; }
      }
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);
      res(canvas.toDataURL('image/jpeg', 0.78));
    };
    img.onerror = () => res(null);
    img.src = ev.target.result;
  };
  r.onerror = () => res(null);
  r.readAsDataURL(file);
});

export default function EditProjet({ projet, onClose, onSave }) {
  const [f, setF] = useState({ nom: projet.nom || '', adresse: projet.adresse || '', photo: projet.photo || null, maitreOuvrage: projet.maitreOuvrage || '' });
  const gallRef = useRef();
  const camRef = useRef();

  const handleFile = async (file) => {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { alert('Image trop grande (max 5 Mo)'); return; }
    const dataUrl = await compress(file);
    if (dataUrl) setF(p => ({ ...p, photo: dataUrl }));
  };

  return (
    <div className="modal-overlay">
      <div className="modal-sheet" style={{ padding:20 }}>
        <div style={{ display:'flex',justifyContent:'space-between',marginBottom:16 }}>
          <p style={{ fontWeight:800,fontSize:15,color:DA.black,margin:0 }}>Modifier le projet</p>
          <button onClick={onClose} style={{ background:'none',border:'none',cursor:'pointer',color:DA.grayL }}><Ic n="x" s={20}/></button>
        </div>

        {/* Photo */}
        <div style={{ position:'relative',width:'100%',height:120,borderRadius:12,border:`2px dashed ${DA.border}`,overflow:'hidden',background:DA.grayXL,display:'flex',alignItems:'center',justifyContent:'center',marginBottom:8 }}>
          {f.photo ? (
            <>
              <img src={f.photo} alt="" style={{ position:'absolute',inset:0,width:'100%',height:'100%',objectFit:'cover' }}/>
              <div style={{ position:'absolute',inset:0,background:'rgba(0,0,0,0.3)',display:'flex',alignItems:'center',justifyContent:'center',gap:8 }}>
                <button onClick={() => gallRef.current.click()} style={{ background:'rgba(255,255,255,0.9)',border:'none',borderRadius:8,padding:'5px 10px',fontSize:11,fontWeight:600,cursor:'pointer',display:'flex',alignItems:'center',gap:4 }}>
                  <Ic n="img" s={12}/> Galerie
                </button>
                <button onClick={() => { camRef.current.value=''; camRef.current.click(); }} style={{ background:'rgba(255,255,255,0.9)',border:'none',borderRadius:8,padding:'5px 10px',fontSize:11,fontWeight:600,cursor:'pointer',display:'flex',alignItems:'center',gap:4 }}>
                  <Ic n="cam" s={12}/> Photo
                </button>
              </div>
            </>
          ) : (
            <div style={{ textAlign:'center' }}>
              <Ic n="cam" s={24}/><p style={{ fontSize:11,color:DA.grayL,marginTop:4 }}>Photo du projet</p>
            </div>
          )}
        </div>
        {!f.photo && (
          <div style={{ display:'flex',gap:8,marginBottom:14 }}>
            <button onClick={() => gallRef.current.click()} style={{ flex:1,border:`1px solid ${DA.border}`,background:'white',borderRadius:8,padding:'6px 0',fontSize:11,fontWeight:600,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',gap:4,color:DA.gray }}>
              <Ic n="img" s={12}/> Galerie
            </button>
            <button onClick={() => { camRef.current.value=''; camRef.current.click(); }} style={{ flex:1,border:'none',background:DA.red,borderRadius:8,padding:'6px 0',fontSize:11,fontWeight:600,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',gap:4,color:'white' }}>
              <Ic n="cam" s={12}/> Photo
            </button>
          </div>
        )}
        <input ref={gallRef} type="file" accept="image/*" style={{ display:'none' }}
          onChange={e => handleFile(e.target.files?.[0])}/>
        <input ref={camRef} type="file" accept="image/*" capture="environment" style={{ display:'none' }}
          onChange={e => { if (e.target.files?.[0]) handleFile(e.target.files[0]); setTimeout(() => { if (camRef.current) camRef.current.value = ''; }, 200); }}/>

        {/* Champs */}
        {FIELDS.map(({ k, l, ph }) => (
          <div key={k} style={{ marginBottom:12 }}>
            <label style={{ display:'block',fontSize:11,fontWeight:700,color:DA.gray,marginBottom:5,textTransform:'uppercase',letterSpacing:0.5 }}>{l}</label>
            <input value={f[k]} onChange={(e) => setF((x) => ({ ...x, [k]: e.target.value }))} placeholder={ph}
              style={{ width:'100%',border:`1px solid ${DA.border}`,borderRadius:8,padding:'10px 12px',fontSize:13,outline:'none',boxSizing:'border-box' }}
              onFocus={(e) => e.target.style.borderColor = DA.red}
              onBlur={(e) => e.target.style.borderColor = DA.border}/>
          </div>
        ))}

        <button onClick={() => { onSave(f); onClose(); }} disabled={!f.nom}
          style={{ width:'100%',background:f.nom ? DA.red : '#ccc',color:'white',border:'none',borderRadius:12,padding:13,fontSize:14,fontWeight:800,cursor:f.nom ? 'pointer' : 'not-allowed',marginTop:4,display:'flex',alignItems:'center',justifyContent:'center',gap:6 }}>
          <Ic n="chk" s={15}/> Enregistrer
        </button>
      </div>
    </div>
  );
}
