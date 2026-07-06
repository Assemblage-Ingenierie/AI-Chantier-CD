import React, { useState, useRef, useEffect } from 'react';
import { DA } from '../../lib/constants.js';
import { Ic } from '../ui/Icons.jsx';
import CropTool from '../ui/CropTool.jsx';
import { getCoverOriginal, setCoverOriginal, fileToCompressedDataUrl } from '../../lib/coverOriginals.js';

const FIELDS = [
  { k: 'nom',          l: 'Nom du projet *',  ph: 'Ex: Résidence Les Acacias'     },
  { k: 'maitreOuvrage',l: "Maître d'ouvrage", ph: 'Ex: Ville de Lyon, M. Dupont…' },
  { k: 'adresse',      l: 'Adresse',          ph: 'Ex: 12 rue des Acacias, Lyon'  },
];

const RATIO_TUILE = 16 / 9;
const RATIO_GARDE = 210 / 85;

export default function EditProjet({ projet, onClose, onSave }) {
  const [f,        setF]       = useState({ nom: projet.nom || '', adresse: projet.adresse || '', photo: projet.photo || null, photoCouverture: projet.photoCouverture || null, maitreOuvrage: projet.maitreOuvrage || '' });
  const [cropSrc,  setCropSrc] = useState(null);
  const [cropStep, setCropStep] = useState(null); // 'tuile' | 'garde'
  const fileRef = useRef();
  const cameraRef = useRef(); // prise directe à l'appareil photo (capture="environment"), pour le terrain
  const originalSrcRef = useRef(null); // blob URL of original full-res photo, kept for recrop

  useEffect(() => () => { if (originalSrcRef.current) URL.revokeObjectURL(originalSrcRef.current); }, []);

  const handleFile = (file) => {
    if (!file) return;
    if (file.size > 25 * 1024 * 1024) { alert('Image trop grande (max 25 Mo)'); return; }
    if (originalSrcRef.current) URL.revokeObjectURL(originalSrcRef.current);
    const blob = URL.createObjectURL(file);
    originalSrcRef.current = blob;
    // Conserver l'ORIGINAL (compressé) en local : « Recadrer » repartira toujours de
    // l'image source, même dans une prochaine session → on peut « dé-recadrer ».
    fileToCompressedDataUrl(file).then(dataUrl => { if (dataUrl) setCoverOriginal(projet.id, dataUrl); });
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
          <p style={{ fontWeight:800, fontSize:15, color:DA.black, margin:0 }}>Modifier le projet</p>
          <button onClick={onClose} style={{ background:'none', border:'none', cursor:'pointer', color:DA.grayL }}><Ic n="x" s={20}/></button>
        </div>

        {/* Zone photo : voile noir transparent (la photo reste visible) + 3 GROS boutons
            d'action directement dessus — Galerie / Appareil photo / Recadrer (demande Thomas,
            le petit « Changer » et la rangée de petits boutons sont supprimés). */}
        <div style={{ position:'relative', width:'100%', paddingTop:'56.25%', borderRadius:12,
            border:`2px dashed ${f.photo ? 'transparent' : DA.border}`,
            overflow:'hidden', background: f.photo ? 'transparent' : DA.grayXL,
            marginBottom:16, boxSizing:'border-box' }}>
          {f.photo && <img src={f.photo} alt="" style={{ position:'absolute', inset:0, width:'100%', height:'100%', objectFit:'cover' }}/>}
          <div style={{ position:'absolute', inset:0, background: f.photo ? 'rgba(0,0,0,0.34)' : 'transparent',
              display:'flex', alignItems:'center', justifyContent:'center', gap:12, flexWrap:'wrap', padding:10 }}>
            {[
              { icon:'img', label:'Galerie',        onClick:() => fileRef.current?.click() },
              // Prise directe sur site : ouvre l'appareil photo (mobile). Sur PC, sélecteur de fichiers.
              { icon:'cam', label:'Appareil photo', onClick:() => cameraRef.current?.click() },
              ...(f.photo ? [{
                icon:'crp', label:'Recadrer',
                onClick: async () => {
                  // Repartir de l'ORIGINAL : blob de la session, sinon original persisté (IndexedDB),
                  // sinon (legacy, original inconnu) l'image croppée courante en dernier recours.
                  const orig = originalSrcRef.current || await getCoverOriginal(projet.id) || f.photo;
                  setCropSrc(orig); setCropStep('tuile');
                },
              }] : []),
            ].map(btn => (
              <button key={btn.label} onClick={btn.onClick}
                style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:7,
                  width:104, height:88, borderRadius:14, border:'none', cursor:'pointer',
                  background: f.photo ? 'rgba(0,0,0,0.48)' : 'white',
                  color: f.photo ? 'white' : DA.gray,
                  boxShadow: f.photo ? 'none' : `inset 0 0 0 1px ${DA.border}`,
                  fontSize:12, fontWeight:700 }}>
                {btn.icon === 'crp' ? <span style={{ fontSize:24, lineHeight:1 }}>✂</span> : <Ic n={btn.icon} s={26}/>}
                {btn.label}
              </button>
            ))}
          </div>
        </div>

        <input ref={fileRef} type="file" accept="image/*" style={{ display:'none' }}
          onChange={e => { const file = e.target.files?.[0]; if (file) handleFile(file); e.target.value = ''; }}/>
        <input ref={cameraRef} type="file" accept="image/*" capture="environment" style={{ display:'none' }}
          onChange={e => { const file = e.target.files?.[0]; if (file) handleFile(file); e.target.value = ''; }}/>

        {FIELDS.map(({ k, l, ph }) => (
          <div key={k} style={{ marginBottom:12 }}>
            <label style={{ display:'block', fontSize:11, fontWeight:700, color:DA.gray, marginBottom:5, textTransform:'uppercase', letterSpacing:0.5 }}>{l}</label>
            <input value={f[k]} onChange={e => setF(x => ({ ...x, [k]: e.target.value }))} placeholder={ph}
              style={{ width:'100%', border:`1px solid ${DA.border}`, borderRadius:8, padding:'10px 12px', fontSize:16, outline:'none', boxSizing:'border-box' }}
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
