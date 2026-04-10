import React, { useState, useRef } from 'react';
import { DA } from '../../lib/constants.js';
import { Ic } from '../ui/Icons.jsx';

const FIELDS = [
  { k: 'nom', l: 'Nom du projet *', ph: 'Ex: Résidence Les Acacias' },
  { k: 'maitreOuvrage', l: "Maître d'ouvrage", ph: 'Ex: Ville de Lyon, M. Dupont…' },
  { k: 'adresse', l: 'Adresse', ph: 'Ex: 12 rue des Acacias, Lyon' },
];

export default function NewProjet({ onClose, onSave }) {
  const [f, setF] = useState({ nom: '', adresse: '', photo: null, maitreOuvrage: '' });
  const ref = useRef();

  return (
    <div className="modal-overlay">
      <div className="modal-sheet" style={{ padding:20 }}>
        <div style={{ display:'flex',justifyContent:'space-between',marginBottom:16 }}>
          <p style={{ fontWeight:800,fontSize:15,color:DA.black,margin:0 }}>Nouveau projet</p>
          <button onClick={onClose} style={{ background:'none',border:'none',cursor:'pointer',color:DA.grayL }}><Ic n="x" s={20}/></button>
        </div>

        {/* Photo */}
        <div onClick={() => ref.current.click()} style={{ position:'relative',width:'100%',height:120,borderRadius:12,border:`2px dashed ${DA.border}`,overflow:'hidden',cursor:'pointer',background:DA.grayXL,display:'flex',alignItems:'center',justifyContent:'center',marginBottom:14 }}>
          {f.photo ? (
            <>
              <img src={f.photo} alt="" style={{ position:'absolute',inset:0,width:'100%',height:'100%',objectFit:'cover' }}/>
              <div style={{ position:'absolute',inset:0,background:'rgba(0,0,0,0.3)',display:'flex',alignItems:'center',justifyContent:'center' }}>
                <span style={{ color:'white',fontSize:12,background:'rgba(0,0,0,0.4)',borderRadius:8,padding:'4px 10px' }}>Changer</span>
              </div>
            </>
          ) : (
            <div style={{ textAlign:'center' }}>
              <Ic n="cam" s={24}/><p style={{ fontSize:11,color:DA.grayL,marginTop:4 }}>Photo du projet</p>
            </div>
          )}
        </div>
        <input ref={ref} type="file" accept="image/*" style={{ display:'none' }} onChange={(e) => {
          const fl = e.target.files[0]; if (!fl) return;
          if (fl.size > 5 * 1024 * 1024) { alert('Image trop grande (max 5 Mo)'); e.target.value = ''; return; }
          const r = new FileReader(); r.onload = (ev) => setF((p) => ({ ...p, photo: ev.target.result })); r.readAsDataURL(fl);
        }}/>

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
          style={{ width:'100%',background:f.nom ? DA.black : '#ccc',color:'white',border:'none',borderRadius:12,padding:13,fontSize:14,fontWeight:800,cursor:f.nom ? 'pointer' : 'not-allowed',marginTop:4 }}>
          Créer le projet
        </button>
      </div>
    </div>
  );
}
