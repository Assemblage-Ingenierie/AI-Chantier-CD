import React, { useState, useRef } from 'react';
import { DA } from '../../lib/constants.js';
import { Ic } from '../ui/Icons.jsx';

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

export default function PhotoModal({ projet, onUpd, onClose }) {
  const [ph, setPh] = useState(projet.photo ?? null);
  const gallRef = useRef();
  const camRef = useRef();

  const handleFile = async (f) => {
    if (!f) return;
    const dataUrl = await compress(f);
    if (dataUrl) setPh(dataUrl);
  };

  return (
    <div style={{ position:'fixed',inset:0,background:'rgba(0,0,0,0.6)',zIndex:50,display:'flex',alignItems:'center',justifyContent:'center',padding:16 }}>
      <div style={{ background:DA.white,borderRadius:16,padding:18,width:'100%',maxWidth:360 }}>
        <div style={{ display:'flex',justifyContent:'space-between',marginBottom:12 }}>
          <p style={{ fontWeight:700,color:DA.black,margin:0 }}>Photo du projet</p>
          <button onClick={onClose} style={{ background:'none',border:'none',cursor:'pointer',color:DA.grayL }}><Ic n="x" s={20}/></button>
        </div>

        <div style={{ position:'relative',width:'100%',height:180,borderRadius:12,border:`2px dashed ${DA.border}`,overflow:'hidden',background:DA.grayXL,display:'flex',alignItems:'center',justifyContent:'center' }}>
          {ph ? (
            <>
              <img src={ph} alt="" style={{ position:'absolute',inset:0,width:'100%',height:'100%',objectFit:'cover' }}/>
              <div style={{ position:'absolute',inset:0,background:'rgba(0,0,0,0.3)',display:'flex',alignItems:'center',justifyContent:'center',gap:8 }}>
                <button onClick={() => gallRef.current.click()} style={{ background:'rgba(255,255,255,0.9)',border:'none',borderRadius:8,padding:'6px 12px',fontSize:12,fontWeight:600,cursor:'pointer',display:'flex',alignItems:'center',gap:4 }}>
                  <Ic n="img" s={13}/> Galerie
                </button>
                <button onClick={() => { camRef.current.value=''; camRef.current.click(); }} style={{ background:'rgba(255,255,255,0.9)',border:'none',borderRadius:8,padding:'6px 12px',fontSize:12,fontWeight:600,cursor:'pointer',display:'flex',alignItems:'center',gap:4 }}>
                  <Ic n="cam" s={13}/> Photo
                </button>
              </div>
            </>
          ) : (
            <div style={{ display:'flex',flexDirection:'column',alignItems:'center',gap:10 }}>
              <div style={{ display:'flex',gap:10 }}>
                <button onClick={() => gallRef.current.click()} style={{ border:`1px solid ${DA.border}`,background:'white',borderRadius:10,padding:'8px 14px',fontSize:12,fontWeight:600,cursor:'pointer',display:'flex',alignItems:'center',gap:5,color:DA.gray }}>
                  <Ic n="img" s={14}/> Galerie
                </button>
                <button onClick={() => { camRef.current.value=''; camRef.current.click(); }} style={{ border:'none',background:DA.red,borderRadius:10,padding:'8px 14px',fontSize:12,fontWeight:600,cursor:'pointer',display:'flex',alignItems:'center',gap:5,color:'white' }}>
                  <Ic n="cam" s={14}/> Photo
                </button>
              </div>
              <p style={{ fontSize:11,color:DA.grayL,margin:0 }}>Ajouter une photo</p>
            </div>
          )}
        </div>

        <input ref={gallRef} type="file" accept="image/*" style={{ display:'none' }}
          onChange={e => handleFile(e.target.files?.[0])}/>
        <input ref={camRef} type="file" accept="image/*" capture="environment" style={{ display:'none' }}
          onChange={e => { if (e.target.files?.[0]) handleFile(e.target.files[0]); setTimeout(() => { if (camRef.current) camRef.current.value = ''; }, 200); }}/>

        <div style={{ display:'flex',gap:8,marginTop:12 }}>
          {ph && <button onClick={() => setPh(null)} style={{ flex:1,border:'1px solid #FCA5A5',color:DA.red,background:'white',borderRadius:10,padding:9,fontSize:12,fontWeight:600,cursor:'pointer' }}>Supprimer</button>}
          <button onClick={() => { onUpd(projet.id,{photo:ph}); onClose(); }} style={{ flex:1,background:DA.black,color:'white',border:'none',borderRadius:10,padding:9,fontSize:12,fontWeight:700,cursor:'pointer' }}>Enregistrer</button>
        </div>
      </div>
    </div>
  );
}
