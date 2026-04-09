import React, { useState, useRef } from 'react';
import { DA } from '../../lib/constants.js';
import { Ic } from '../ui/Icons.jsx';

export default function PhotoModal({ projet, onUpd, onClose }) {
  const [ph, setPh] = useState(projet.photo ?? null);
  const ref = useRef();

  return (
    <div style={{ position:'fixed',inset:0,background:'rgba(0,0,0,0.6)',zIndex:50,display:'flex',alignItems:'center',justifyContent:'center',padding:16 }}>
      <div style={{ background:DA.white,borderRadius:16,padding:18,width:'100%',maxWidth:360 }}>
        <div style={{ display:'flex',justifyContent:'space-between',marginBottom:12 }}>
          <p style={{ fontWeight:700,color:DA.black,margin:0 }}>Photo du projet</p>
          <button onClick={onClose} style={{ background:'none',border:'none',cursor:'pointer',color:DA.grayL }}><Ic n="x" s={20}/></button>
        </div>

        <div onClick={() => ref.current.click()} style={{ position:'relative',width:'100%',height:180,borderRadius:12,border:`2px dashed ${DA.border}`,overflow:'hidden',cursor:'pointer',background:DA.grayXL,display:'flex',alignItems:'center',justifyContent:'center' }}>
          {ph ? (
            <>
              <img src={ph} alt="" style={{ position:'absolute',inset:0,width:'100%',height:'100%',objectFit:'cover' }}/>
              <div style={{ position:'absolute',inset:0,background:'rgba(0,0,0,0.3)',display:'flex',alignItems:'center',justifyContent:'center' }}>
                <span style={{ background:'rgba(255,255,255,0.9)',borderRadius:8,padding:'6px 12px',fontSize:12,fontWeight:600 }}>Changer</span>
              </div>
            </>
          ) : (
            <div style={{ textAlign:'center' }}>
              <Ic n="img" s={28} /><p style={{ fontSize:12,color:DA.gray,marginTop:6 }}>Ajouter une photo</p>
            </div>
          )}
        </div>

        <input ref={ref} type="file" accept="image/*" style={{ display:'none' }} onChange={(e) => {
          const f = e.target.files[0]; if (!f) return;
          const r = new FileReader(); r.onload = (ev) => setPh(ev.target.result); r.readAsDataURL(f);
        }}/>

        <div style={{ display:'flex',gap:8,marginTop:12 }}>
          {ph && <button onClick={() => setPh(null)} style={{ flex:1,border:'1px solid #FCA5A5',color:DA.red,background:'white',borderRadius:10,padding:9,fontSize:12,fontWeight:600,cursor:'pointer' }}>Supprimer</button>}
          <button onClick={() => { onUpd(projet.id,{photo:ph}); onClose(); }} style={{ flex:1,background:DA.black,color:'white',border:'none',borderRadius:10,padding:9,fontSize:12,fontWeight:700,cursor:'pointer' }}>Enregistrer</button>
        </div>
      </div>
    </div>
  );
}
