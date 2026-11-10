import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { DA } from '../../lib/constants.js';
import { Ic } from '../ui/Icons.jsx';
import { captureRotation } from '../../lib/deviceCamera.js';

// VISEUR PHOTO INTÉGRÉ (retour Thomas 10/11 : sur Samsung / vieux Pixel, « Photo » demandait
// « galerie ou appareil photo ? », et le comportement variait d'un téléphone à l'autre).
// Le viseur s'ouvre DANS l'app → identique sur iPhone et Android, aucun menu de choix, et le
// téléphone ne ferme plus l'app pendant la photo (cause de photos perdues sur les vieux Android
// quand l'appareil photo du système prenait toute la mémoire).
//   • rafale : on enchaîne les photos, « Terminé » ferme ;
//   • lampe (si le téléphone la propose) ;
//   • « Appareil photo du téléphone » : ouvre l'appli photo native (flash, modes nuit…) ;
//   • caméra refusée / indisponible → bascule directe sur l'appareil photo du téléphone.
// onShot(file) reçoit chaque photo (JPEG pleine résolution du capteur vidéo).
export default function CameraCapture({ onShot, onNative, onClose }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const orientRef = useRef({ beta: null, gamma: null });
  const [ready, setReady] = useState(false);
  const [err, setErr] = useState(null);
  const [count, setCount] = useState(0);
  const [flash, setFlash] = useState(false);
  const [torchCap, setTorchCap] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [rot, setRot] = useState(0); // rotation détectée → icône de l'obturateur tournée (on voit que c'est compris)

  useEffect(() => {
    let alive = true;
    const start = async () => {
      if (!navigator.mediaDevices?.getUserMedia) { setErr('unsupported'); return; }
      const tries = [
        { audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 4032 }, height: { ideal: 3024 } } },
        { audio: false, video: { facingMode: { ideal: 'environment' } } },
        { audio: false, video: true },
      ];
      let stream = null, lastErr = null;
      for (const c of tries) {
        try { stream = await navigator.mediaDevices.getUserMedia(c); break; }
        catch (e) { lastErr = e; if (e?.name === 'NotAllowedError' || e?.name === 'SecurityError') break; }
      }
      if (!alive) { stream?.getTracks().forEach(t => t.stop()); return; }
      if (!stream) { setErr(lastErr?.name === 'NotAllowedError' ? 'denied' : 'unavailable'); return; }
      streamRef.current = stream;
      const track = stream.getVideoTracks()[0];
      try { setTorchCap(!!track?.getCapabilities?.().torch); } catch { /* pas de lampe */ }
      const v = videoRef.current;
      if (v) {
        v.srcObject = stream;
        try { await v.play(); } catch { /* lecture auto bloquée : le flux s'affiche quand même au 1er geste */ }
      }
      if (alive) setReady(true);
    };
    start();
    const onOrient = (e) => {
      orientRef.current = { beta: e.beta, gamma: e.gamma };
      const r = captureRotation({ uiAngle: screen?.orientation?.angle ?? window.orientation ?? 0, beta: e.beta, gamma: e.gamma });
      setRot(prev => (prev === r ? prev : r));
    };
    window.addEventListener('deviceorientation', onOrient);
    return () => {
      alive = false;
      window.removeEventListener('deviceorientation', onOrient);
      streamRef.current?.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    };
  }, []);


  const toggleTorch = async () => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    try { await track.applyConstraints({ advanced: [{ torch: !torchOn }] }); setTorchOn(v => !v); } catch { /* non supporté */ }
  };

  const shoot = async () => {
    const v = videoRef.current;
    if (!v || !v.videoWidth || busy) return;
    setBusy(true);
    setFlash(true); setTimeout(() => setFlash(false), 120);
    try {
      const { beta, gamma } = orientRef.current;
      const r = captureRotation({ uiAngle: screen?.orientation?.angle ?? window.orientation ?? 0, beta, gamma });
      const w = v.videoWidth, h = v.videoHeight;
      const turn = r === 90 || r === -90;
      const cv = document.createElement('canvas');
      cv.width = turn ? h : w; cv.height = turn ? w : h;
      const ctx = cv.getContext('2d');
      ctx.translate(cv.width / 2, cv.height / 2);
      ctx.rotate((r * Math.PI) / 180);
      ctx.drawImage(v, -w / 2, -h / 2, w, h);
      const blob = await new Promise(res => cv.toBlob(res, 'image/jpeg', 0.92));
      if (blob) {
        const file = new File([blob], `photo_${Date.now()}.jpg`, { type: 'image/jpeg', lastModified: Date.now() });
        onShot?.(file);
        setCount(c => c + 1);
      }
    } catch { /* capture impossible : on reste dans le viseur */ }
    setBusy(false);
  };

  const close = () => { streamRef.current?.getTracks().forEach(t => t.stop()); onClose?.(count); };

  // Caméra refusée / indisponible → un bouton (le navigateur exige un geste pour ouvrir
  // l'appareil photo du téléphone : impossible de basculer tout seul).
  const msg = err === 'denied' ? 'L\'accès à la caméra a été refusé pour l\'app.'
    : err ? 'La caméra n\'est pas disponible dans l\'app sur ce téléphone.' : null;

  return createPortal(
    <div role="dialog" aria-label="Prendre des photos"
      style={{ position:'fixed', inset:0, zIndex:80, background:'#000', display:'flex', flexDirection:'column', color:'white', paddingTop:'env(safe-area-inset-top)', paddingBottom:'env(safe-area-inset-bottom)' }}>
      <div style={{ position:'relative', flex:1, minHeight:0, overflow:'hidden', display:'flex', alignItems:'center', justifyContent:'center' }}>
        <video ref={videoRef} playsInline muted autoPlay
          style={{ width:'100%', height:'100%', objectFit:'contain', background:'#000' }}/>
        {flash && <div style={{ position:'absolute', inset:0, background:'white', opacity:0.7, pointerEvents:'none' }}/>}
        {(!ready || msg) && (
          <div style={{ position:'absolute', inset:0, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:10, padding:24, textAlign:'center' }}>
            {!msg && <Ic n="spn" s={26}/>}
            <span style={{ fontSize:14, opacity:0.9 }}>{msg || 'Ouverture de la caméra…'}</span>
            {msg && (
              <button onClick={() => onNative?.()}
                style={{ marginTop:6, padding:'12px 18px', borderRadius:12, border:'none', background:DA.red, color:'white', fontSize:14, fontWeight:800, cursor:'pointer' }}>
                Ouvrir l'appareil photo du téléphone
              </button>
            )}
          </div>
        )}
        <button onClick={close} aria-label="Fermer"
          style={{ position:'absolute', top:12, left:12, width:44, height:44, borderRadius:'50%', border:'none', background:'rgba(0,0,0,0.45)', color:'white', display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer' }}>
          <Ic n="x" s={20}/>
        </button>
        {torchCap && (
          <button onClick={toggleTorch} aria-label={torchOn ? 'Éteindre la lampe' : 'Allumer la lampe'}
            style={{ position:'absolute', top:12, right:12, height:44, padding:'0 14px', borderRadius:22, border:'none', background: torchOn ? '#FACC15' : 'rgba(0,0,0,0.45)', color: torchOn ? '#111' : 'white', fontSize:13, fontWeight:700, cursor:'pointer' }}>
            ⚡ Lampe
          </button>
        )}
      </div>

      <div style={{ flexShrink:0, display:'grid', gridTemplateColumns:'1fr auto 1fr', alignItems:'center', padding:'14px 18px 18px', gap:12 }}>
        <button onClick={() => { streamRef.current?.getTracks().forEach(t => t.stop()); onNative?.(); }}
          style={{ justifySelf:'start', background:'none', border:'1px solid rgba(255,255,255,0.35)', color:'white', borderRadius:10, padding:'8px 10px', fontSize:11.5, fontWeight:600, lineHeight:1.25, textAlign:'left', cursor:'pointer', maxWidth:130 }}>
          Appareil photo du téléphone
        </button>
        <button onClick={shoot} disabled={!ready || busy} aria-label="Prendre la photo"
          style={{ width:74, height:74, borderRadius:'50%', border:'4px solid white', background: busy ? '#999' : DA.red, cursor: ready ? 'pointer' : 'default',
            display:'flex', alignItems:'center', justifyContent:'center', boxShadow:'0 0 0 3px rgba(0,0,0,0.4)', transform:`rotate(${rot}deg)`, transition:'transform 0.2s' }}>
          <Ic n="cam" s={26}/>
        </button>
        <button onClick={close}
          style={{ justifySelf:'end', background: count ? 'white' : 'none', border: count ? 'none' : '1px solid rgba(255,255,255,0.35)', color: count ? DA.black : 'white', borderRadius:10, padding:'10px 14px', fontSize:13, fontWeight:800, cursor:'pointer' }}>
          {count ? `Terminé (${count})` : 'Annuler'}
        </button>
      </div>
    </div>,
    document.body
  );
}
