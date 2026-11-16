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
export default function CameraCapture({ onShot, onNative, onClose, onPlace = null }) {
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
  // ZOOM + GRAND ANGLE (retour Thomas 16/11 : « je perds le grand angle, je ne peux pas zoomer »).
  //  • zoom MATÉRIEL si le téléphone le propose (capabilities.zoom ; min < 1 = grand angle) ;
  //  • sinon zoom NUMÉRIQUE (recadrage au centre, appliqué aussi à la photo) ;
  //  • objectif ultra grand angle séparé (iPhone, certains Android) : bouton « 0.5× ».
  //  Pincer l'image à deux doigts = zoom ; pastilles 0.5× / 1× / 2× / 5× au-dessus du déclencheur.
  const [zoomCap, setZoomCap] = useState(null); // { min, max } si zoom matériel
  const [zoom, setZoom] = useState(1);
  const zoomRef = useRef(1); zoomRef.current = zoom;
  const [wideId, setWideId] = useState(null);   // deviceId de l'objectif ultra grand angle (si connu)
  // Android : l'ultra grand angle n'est souvent pas nommé (« camera2 2, facing back ») → si le
  // téléphone expose PLUSIEURS caméras arrière, bouton « ⟲ Objectif » pour passer de l'une à l'autre.
  const [backCams, setBackCams] = useState([]);
  const [camIdx, setCamIdx] = useState(0);
  const [onWide, setOnWide] = useState(false);
  const mainIdRef = useRef(null);
  const pinchRef = useRef(null);

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
      try {
        const zc = track?.getCapabilities?.().zoom;
        if (zc && Number.isFinite(zc.min) && Number.isFinite(zc.max) && zc.max > zc.min) {
          setZoomCap({ min: zc.min, max: zc.max });
          const cur = track.getSettings?.().zoom;
          setZoom(Number.isFinite(cur) ? cur : Math.max(1, zc.min));
        }
      } catch { /* pas de zoom matériel → zoom numérique */ }
      try {
        mainIdRef.current = track?.getSettings?.().deviceId || null;
        const devs = (await navigator.mediaDevices.enumerateDevices?.()) || [];
        const wide = devs.find(d => d.kind === 'videoinput' && d.deviceId && d.deviceId !== mainIdRef.current && /ultra|grand.?angle/i.test(d.label || ''));
        if (alive && wide) setWideId(wide.deviceId);
        const backs = devs.filter(d => d.kind === 'videoinput' && d.deviceId && !/front|avant|user|facetime/i.test(d.label || ''));
        if (alive && backs.length > 1) {
          setBackCams(backs.map(d => d.deviceId));
          setCamIdx(Math.max(0, backs.findIndex(d => d.deviceId === mainIdRef.current)));
        }
      } catch { /* pas de liste d'objectifs */ }
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


  // Applique un niveau de zoom (matériel si possible, sinon numérique).
  const applyZoom = (z) => {
    const lo = zoomCap ? zoomCap.min : 1, hi = zoomCap ? zoomCap.max : 5;
    const v = Math.max(lo, Math.min(hi, z));
    setZoom(v);
    if (zoomCap) {
      const track = streamRef.current?.getVideoTracks()[0];
      try { track?.applyConstraints({ advanced: [{ zoom: v }] }).catch(() => {}); } catch { /* ignore */ }
    }
  };
  // Bascule d'objectif (ultra grand angle ↔ principal) : on relance le flux sur l'autre caméra.
  const switchLens = async (toWide) => {
    const id = toWide ? wideId : mainIdRef.current;
    if (!id || toWide === onWide) return;
    try {
      const s2 = await navigator.mediaDevices.getUserMedia({ audio: false, video: { deviceId: { exact: id }, width: { ideal: 4032 }, height: { ideal: 3024 } } });
      streamRef.current?.getTracks().forEach(t => t.stop());
      streamRef.current = s2;
      if (videoRef.current) { videoRef.current.srcObject = s2; try { await videoRef.current.play(); } catch { /* ignore */ } }
      setOnWide(toWide);
      setTorchOn(false);
      const t2 = s2.getVideoTracks()[0];
      let zc = null; try { zc = t2?.getCapabilities?.().zoom || null; } catch { /* ignore */ }
      setZoomCap(zc && zc.max > zc.min ? { min: zc.min, max: zc.max } : null);
      setZoom(1);
    } catch { /* objectif indisponible : on reste sur l'actuel */ }
  };
  const onPinchStart = (e) => {
    if (e.touches?.length === 2) {
      const d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
      pinchRef.current = { d, z: zoomRef.current };
    }
  };
  const onPinchMove = (e) => {
    const p = pinchRef.current;
    if (!p || e.touches?.length !== 2) return;
    const d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
    applyZoom(p.z * (d / (p.d || 1)));
  };
  const onPinchEnd = () => { pinchRef.current = null; };
  const digital = !zoomCap && zoom > 1; // zoom numérique (recadrage)

  // Caméra arrière suivante (Android sans nom d'objectif) : on relance le flux dessus.
  const cycleCam = async () => {
    if (backCams.length < 2) return;
    const next = (camIdx + 1) % backCams.length;
    try {
      const s2 = await navigator.mediaDevices.getUserMedia({ audio: false, video: { deviceId: { exact: backCams[next] }, width: { ideal: 4032 }, height: { ideal: 3024 } } });
      streamRef.current?.getTracks().forEach(t => t.stop());
      streamRef.current = s2;
      if (videoRef.current) { videoRef.current.srcObject = s2; try { await videoRef.current.play(); } catch { /* ignore */ } }
      setCamIdx(next); setTorchOn(false); setOnWide(false);
      const t2 = s2.getVideoTracks()[0];
      let zc = null; try { zc = t2?.getCapabilities?.().zoom || null; } catch { /* ignore */ }
      setZoomCap(zc && zc.max > zc.min ? { min: zc.min, max: zc.max } : null);
      setZoom(1);
    } catch { /* caméra indisponible */ }
  };

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
      // Zoom numérique : on garde le CENTRE de l'image (ce qu'on voit à l'écran).
      const dz = !zoomCap && zoomRef.current > 1 ? zoomRef.current : 1;
      const w = Math.round(v.videoWidth / dz), h = Math.round(v.videoHeight / dz);
      const sx = Math.round((v.videoWidth - w) / 2), sy = Math.round((v.videoHeight - h) / 2);
      const turn = r === 90 || r === -90;
      const cv = document.createElement('canvas');
      cv.width = turn ? h : w; cv.height = turn ? w : h;
      const ctx = cv.getContext('2d');
      ctx.translate(cv.width / 2, cv.height / 2);
      ctx.rotate((r * Math.PI) / 180);
      ctx.drawImage(v, sx, sy, w, h, -w / 2, -h / 2, w, h);
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
      <div onTouchStart={onPinchStart} onTouchMove={onPinchMove} onTouchEnd={onPinchEnd} onTouchCancel={onPinchEnd}
        style={{ position:'relative', flex:1, minHeight:0, overflow:'hidden', display:'flex', alignItems:'center', justifyContent:'center', touchAction:'none' }}>
        <video ref={videoRef} playsInline muted autoPlay
          style={{ width:'100%', height:'100%', objectFit:'contain', background:'#000', transform: digital ? `scale(${zoom})` : 'none', transformOrigin:'center' }}/>
        {/* Niveaux de zoom (comme l'appareil photo du téléphone) */}
        {ready && !msg && (
          <div style={{ position:'absolute', bottom:12, left:'50%', transform:'translateX(-50%)', display:'flex', gap:6, background:'rgba(0,0,0,0.35)', borderRadius:20, padding:4 }}>
            {[
              ...((wideId || (zoomCap && zoomCap.min < 0.95)) ? [{ k: 'w', l: zoomCap && zoomCap.min < 0.95 && !wideId ? `${Math.round(zoomCap.min * 10) / 10}×` : '0.5×', on: onWide || (zoomCap && !wideId && zoom < 0.95),
                go: () => (wideId ? switchLens(true) : applyZoom(zoomCap.min)) }] : []),
              { k: '1', l: '1×', on: !onWide && zoom >= 0.95 && zoom < 1.5, go: () => (onWide ? switchLens(false) : applyZoom(1)) },
              { k: '2', l: '2×', on: !onWide && zoom >= 1.5 && zoom < 3.5, go: () => { if (onWide) switchLens(false).then(() => applyZoom(2)); else applyZoom(2); } },
              ...((!zoomCap || zoomCap.max >= 4) ? [{ k: '5', l: '5×', on: !onWide && zoom >= 3.5, go: () => { if (onWide) switchLens(false).then(() => applyZoom(5)); else applyZoom(5); } }] : []),
              ...((!wideId && backCams.length > 1) ? [{ k: 'cyc', l: `⟲ ${camIdx + 1}/${backCams.length}`, on: false, go: cycleCam }] : []),
            ].map(b => (
              <button key={b.k} onClick={b.go}
                style={{ minWidth:38, height:32, borderRadius:16, border:'none', cursor:'pointer', fontSize:12, fontWeight:800,
                  background: b.on ? 'rgba(255,255,255,0.92)' : 'transparent', color: b.on ? '#111' : 'white' }}>
                {b.l}
              </button>
            ))}
          </div>
        )}
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
        {/* « Placer » (retour Thomas 16/11) : la DERNIÈRE photo prise est posée sur le plan, puis on
            revient ici, en rafale. Remplace l'ancien bouton « Appareil photo du téléphone »
            (l'interrupteur « Rafale » de l'observation choisit l'appareil). */}
        {onPlace ? (
          <button onClick={() => { if (!count) return; streamRef.current?.getTracks().forEach(t => t.stop()); onPlace(); }} disabled={!count}
            style={{ justifySelf:'start', background: count ? 'rgba(255,255,255,0.15)' : 'none', border:'1px solid rgba(255,255,255,0.35)', color:'white', opacity: count ? 1 : 0.45, borderRadius:10, padding:'10px 12px', fontSize:13, fontWeight:800, cursor: count ? 'pointer' : 'default' }}>
            📍 Placer
          </button>
        ) : <span/>}
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
