import React, { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
const isDesktop = typeof window !== 'undefined' && window.innerWidth >= 768;
import { DA, URGENCE, SUIVI } from '../../lib/constants.js';
import { Ic } from '../ui/Icons.jsx';
import IASug from './IASug.jsx';
import { callAIProxy } from '../../lib/aiProxy.js';

const DRAFT_KEY = (id) => `chantierai_draft_${id || 'new'}`;

export default function ItemModal({ item, planBg, planAnnotations, onClose, onSave, onOpenAnnot }) {
  const [form, setForm] = useState(() => {
    const base = item
      ? { ...item, photos: (item.photos||[]).filter(ph => ph.data), suivi: item.suivi||'rien' }
      : { titre:'', commentaire:'', urgence:'rien', photos:[], suivi:'rien' };
    try {
      const saved = localStorage.getItem(DRAFT_KEY(item?.id));
      if (saved) {
        const draft = JSON.parse(saved);
        if (draft.titre || draft.commentaire) return { ...base, ...draft, photos: base.photos };
      }
    } catch {}
    return base;
  });
  const [draftRestored, setDraftRestored] = useState(() => {
    try {
      const saved = localStorage.getItem(DRAFT_KEY(item?.id));
      if (saved) { const d = JSON.parse(saved); return !!(d.titre || d.commentaire); }
    } catch {}
    return false;
  });
  const [showPlan, setShowPlan] = useState(false);
  const [compressing, setCompressing] = useState(false);
  const [recording, setRecording] = useState(false);
  const [interimText, setInterimText] = useState('');
  const [correcting, setCorrecting] = useState(false);
  const gallRef = useRef();
  const camRef = useRef();
  const textareaRef = useRef();

  // Auto-grow textarea
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.max(el.scrollHeight, isDesktop ? 180 : 90) + 'px';
  }, [form.commentaire]);
  const recogRef       = useRef(null);
  const recordingRef   = useRef(false);
  const lastFinalIdx   = useRef(0);
  const sessionFirst   = useRef(true);
  const lastCommitted  = useRef('');
  const sessionText    = useRef('');
  const restartTimer   = useRef(null);

  // Stop dictaphone si la modale se ferme
  useEffect(() => () => {
    recordingRef.current = false;
    clearTimeout(restartTimer.current);
    recogRef.current?.abort();
  }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      try { localStorage.setItem(DRAFT_KEY(item?.id), JSON.stringify({ titre: form.titre, commentaire: form.commentaire, urgence: form.urgence, suivi: form.suivi })); } catch {}
    }, 600);
    return () => clearTimeout(t);
  }, [form.titre, form.commentaire, form.urgence, form.suivi]);

  const handleSave = () => {
    try { localStorage.removeItem(DRAFT_KEY(item?.id)); } catch {}
    onSave(form);
    onClose();
  };

  const doRecognize = useCallback(() => {
    if (!recordingRef.current) return;
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return;
    const r = new SR();
    r.lang = 'fr-FR';
    r.continuous = true;
    r.interimResults = true;
    r.maxAlternatives = 3;

    r.onresult = (e) => {
      let interim = '';
      const finals = [];
      for (let i = lastFinalIdx.current; i < e.results.length; i++) {
        if (e.results[i].isFinal) {
          // Pick the alternative with highest confidence
          let best = e.results[i][0];
          for (let a = 1; a < e.results[i].length; a++) {
            if (e.results[i][a].confidence > best.confidence) best = e.results[i][a];
          }
          finals.push(best.transcript.trim());
          lastFinalIdx.current = i + 1;
        } else {
          interim += e.results[i][0].transcript;
        }
      }
      setInterimText(interim);
      if (finals.length) {
        let txt = finals.filter(Boolean).join(' ');
        if (!txt) return;

        // iOS after restart sometimes resends the full accumulated transcript
        // (e.g. previous "bonjour" + new "comment" = "bonjour comment").
        // Strip words already committed this session by comparing word-by-word.
        if (sessionText.current) {
          const rawWords = txt.toLowerCase().split(/\s+/).filter(Boolean);
          const sesWords = sessionText.current.toLowerCase().split(/\s+/).filter(Boolean);
          let matched = 0;
          for (let i = 0; i < Math.min(rawWords.length, sesWords.length); i++) {
            if (rawWords[i] === sesWords[i]) matched++;
            else break;
          }
          if (matched === rawWords.length) return; // entirely duplicate
          if (matched === sesWords.length && matched > 0) {
            txt = txt.split(/\s+/).slice(matched).join(' ').trim();
          }
        }

        if (!txt || txt === lastCommitted.current) return;
        lastCommitted.current = txt;
        sessionText.current = sessionText.current ? sessionText.current + ' ' + txt : txt;

        const first = sessionFirst.current;
        sessionFirst.current = false;
        setForm(f => ({
          ...f,
          commentaire: f.commentaire ? f.commentaire + (first ? '\n' : ' ') + txt : txt,
        }));
      }
    };

    r.onerror = (ev) => {
      // not-allowed = fatal permission error, stop entirely
      if (ev.error === 'not-allowed') {
        alert('Accès au microphone refusé. Vérifiez les permissions de votre navigateur.');
        recordingRef.current = false;
        recogRef.current = null;
        setInterimText('');
        setRecording(false);
        return;
      }
      // All other errors (no-speech, aborted, network, audio-capture…) are non-fatal.
      // onend always fires after onerror — let onend handle any restart to avoid
      // starting two concurrent recognition sessions (the "8x repeat" bug).
    };

    r.onend = () => {
      recogRef.current = null;
      setInterimText('');
      // iOS/mobile : la reconnaissance s'arrête automatiquement après ~5-10s
      // Si l'utilisateur tient encore le bouton, on relance immédiatement
      if (recordingRef.current) {
        lastFinalIdx.current = 0;
        restartTimer.current = setTimeout(doRecognize, 150);
        return;
      }
      setRecording(false);
    };

    try {
      r.start();
      recogRef.current = r;
    } catch (e) {
      recordingRef.current = false;
      setRecording(false);
    }
  }, []);

  const startDictaphone = () => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { alert('Dictaphone non supporté — utilisez Chrome ou Safari récent.'); return; }
    recordingRef.current = true;
    lastFinalIdx.current = 0;
    sessionFirst.current = true;
    lastCommitted.current = '';
    sessionText.current = '';
    setInterimText('');
    setRecording(true);
    doRecognize();
  };

  const stopDictaphone = () => {
    recordingRef.current = false;
    clearTimeout(restartTimer.current);
    setRecording(false);   // feedback immédiat — pas d'attente de onend
    setInterimText('');
    recogRef.current?.stop(); // délivre quand même le dernier mot via onresult
  };

  const fixSpelling = async () => {
    if (!form.commentaire?.trim() || correcting) return;
    setCorrecting(true);
    try {
      const d = await callAIProxy({
        feature: 'spell-correction',
        model: 'gemma-3-12b-it',
        max_tokens: 600,
        system: 'Correcteur orthographe et grammaire français. Corrige UNIQUEMENT les fautes sans reformuler. Garde le vocabulaire technique de chantier. Réponds UNIQUEMENT avec le texte corrigé, sans guillemets ni explication.',
        messages: [{ role: 'user', content: form.commentaire }],
      });
      const corrected = d.content?.[0]?.text?.trim();
      if (corrected) setForm(f => ({ ...f, commentaire: corrected }));
    } catch (e) { console.error('Spell check:', e); }
    setCorrecting(false);
  };

  const compressPhoto = (file) => new Promise(res => {
    const r = new FileReader();
    r.onerror = () => res(null);
    r.onload = ev => {
      const img = new Image();
      img.onerror = () => res(null);
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
        const name = file.name.replace(/\.[^.]+$/, '.jpg');
        res({ data: canvas.toDataURL('image/jpeg', 0.78), name });
      };
      img.src = ev.target.result;
    };
    r.readAsDataURL(file);
  });

  const readFiles = files => {
    const filtered = Array.from(files).filter(f => {
      if (f.size > 25 * 1024 * 1024) { alert(`"${f.name}" est trop volumineux (max 25 Mo)`); return false; }
      return true;
    });
    if (!filtered.length) return;
    setCompressing(true);
    Promise.all(filtered.map(compressPhoto))
      .then(done => setForm(prev => ({ ...prev, photos: [...prev.photos, ...done.filter(Boolean)] })))
      .finally(() => setCompressing(false));
  };

  if (showPlan) return (
    <div style={{ position:'fixed',inset:0,background:'rgba(0,0,0,0.92)',zIndex:50,display:'flex',flexDirection:'column' }}>
      <div style={{ display:'flex',alignItems:'center',justifyContent:'space-between',padding:'12px 16px',background:DA.black,flexShrink:0 }}>
        <p style={{ fontWeight:600,color:'white',fontSize:13 }}>Plan de la zone</p>
        <div style={{ display:'flex',gap:8 }}>
          {planBg && (
            <button onClick={() => { setShowPlan(false); onOpenAnnot(form); }}
              style={{ background:DA.red,color:'white',border:'none',borderRadius:8,padding:'6px 12px',fontSize:12,fontWeight:600,display:'flex',alignItems:'center',gap:4,cursor:'pointer' }}>
              <Ic n="pen" s={12}/> Annoter
            </button>
          )}
          <button onClick={() => setShowPlan(false)} style={{ background:'none',border:`1px solid rgba(255,255,255,0.2)`,borderRadius:8,color:DA.grayL,width:34,height:34,display:'flex',alignItems:'center',justifyContent:'center',cursor:'pointer',flexShrink:0 }}><Ic n="x" s={18}/></button>
        </div>
      </div>
      <div style={{ flex:1,overflow:'auto',display:'flex',alignItems:'flex-start',justifyContent:'center',padding:8,background:'#1a1a1a' }}>
        {planBg
          ? <img src={planAnnotations?.exported || planBg} alt="plan" style={{ maxWidth:'100%',height:'auto' }}/>
          : <div style={{ color:DA.grayL,textAlign:'center',padding:48 }}><Ic n="map" s={40}/><p style={{ marginTop:12 }}>Aucun plan pour cette zone</p></div>
        }
      </div>
    </div>
  );

  return (
    <div className="modal-overlay" style={{ zIndex:40 }}>
      <div className="modal-sheet">
        <div style={{ padding:20 }}>
          <div style={{ display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:draftRestored ? 8 : 16 }}>
            <p style={{ fontWeight:700,fontSize:15,color:DA.black }}>
              {item ? "Modifier l'observation" : 'Nouvelle observation'}
            </p>
            <button onClick={onClose} style={{ background:'none',border:'none',cursor:'pointer',color:DA.grayL,display:'flex',alignItems:'center',justifyContent:'center',padding:4 }}><Ic n="x" s={20}/></button>
          </div>
          {draftRestored && (
            <div style={{ display:'flex',alignItems:'center',gap:6,padding:'6px 10px',background:'#FFF7ED',border:'1px solid #FCD34D',borderRadius:8,marginBottom:14 }}>
              <span style={{ fontSize:11,color:'#92400E',fontWeight:600 }}>📝 Brouillon restauré</span>
              <button onClick={() => { setDraftRestored(false); try { localStorage.removeItem(DRAFT_KEY(item?.id)); } catch {} setForm(item ? { ...item, photos:(item.photos||[]).filter(ph=>ph.data), suivi:item.suivi||'rien' } : { titre:'',commentaire:'',urgence:'moyenne',photos:[],suivi:'rien' }); }}
                style={{ marginLeft:'auto',fontSize:10,color:'#92400E',background:'none',border:'1px solid #FCD34D',borderRadius:5,padding:'2px 7px',cursor:'pointer',fontWeight:600 }}>
                Ignorer
              </button>
            </div>
          )}

          {/* Titre */}
          <div style={{ marginBottom:14 }}>
            <label style={{ display:'block',fontSize:12,fontWeight:600,color:DA.gray,marginBottom:6,textTransform:'uppercase',letterSpacing:0.5 }}>Intitulé *</label>
            <input value={form.titre} onChange={e => setForm(f => ({ ...f, titre: e.target.value }))}
              placeholder="Ex: Fissures, Humidité…"
              style={{ width:'100%',border:`1px solid ${DA.border}`,borderRadius:8,padding:'12px 14px',fontSize:15,outline:'none',boxSizing:'border-box' }}
              onFocus={e => e.target.style.borderColor=DA.red} onBlur={e => e.target.style.borderColor=DA.border}/>
          </div>

          {/* Urgence */}
          <div style={{ marginBottom:14 }}>
            <label style={{ display:'block',fontSize:12,fontWeight:600,color:DA.gray,marginBottom:8,textTransform:'uppercase',letterSpacing:0.5 }}>Niveau</label>
            <div style={{ display:'flex',gap:6,flexWrap:'wrap' }}>
              {Object.entries(URGENCE).map(([k, u]) => (
                <button key={k} onClick={() => setForm(f => ({ ...f, urgence: k }))}
                  style={{ padding:'8px 12px',borderRadius:20,fontSize:13,fontWeight:600,border:`1.5px solid ${form.urgence===k?u.border:DA.border}`,background:form.urgence===k?u.bg:'white',color:form.urgence===k?u.text:DA.gray,display:'flex',alignItems:'center',gap:4,transition:'all 0.15s',cursor:'pointer' }}>
                  <span style={{ width:7,height:7,borderRadius:'50%',background:u.dot,display:'inline-block' }}/>{u.label}
                </button>
              ))}
            </div>
          </div>

          {/* Suivi */}
          <div style={{ marginBottom:14 }}>
            <label style={{ display:'block',fontSize:12,fontWeight:600,color:DA.gray,marginBottom:8,textTransform:'uppercase',letterSpacing:0.5 }}>Suivi</label>
            <div style={{ display:'flex',gap:6,flexWrap:'wrap' }}>
              {Object.entries(SUIVI).map(([k, s]) => (
                <button key={k} onClick={() => setForm(f => ({ ...f, suivi: k }))}
                  style={{ padding:'8px 12px',borderRadius:20,fontSize:13,fontWeight:600,border:`1.5px solid ${form.suivi===k?s.border:DA.border}`,background:form.suivi===k?s.bg:'white',color:form.suivi===k?s.text:DA.gray,display:'flex',alignItems:'center',gap:4,transition:'all 0.15s',cursor:'pointer' }}>
                  <span style={{ width:7,height:7,borderRadius:'50%',background:s.dot,display:'inline-block' }}/>{s.label}
                </button>
              ))}
            </div>
          </div>

          {/* Commentaire */}
          <div style={{ marginBottom:14 }}>
            <label style={{ display:'block',fontSize:12,fontWeight:600,color:DA.gray,textTransform:'uppercase',letterSpacing:0.5,marginBottom:6 }}>Commentaire</label>
            <textarea ref={textareaRef} value={form.commentaire || ''} onChange={e => setForm(f => ({ ...f, commentaire: e.target.value }))}
              placeholder="Description détaillée…"
              style={{ width:'100%',border:`1px solid ${recording ? DA.red : DA.border}`,borderRadius:8,padding:'12px 14px',fontSize: isDesktop ? 15 : 15,outline:'none',resize:'none',boxSizing:'border-box',fontFamily:'inherit',transition:'border-color 0.15s',overflow:'hidden',lineHeight:1.65,minHeight: isDesktop ? 180 : 90 }}
              onFocus={e => e.target.style.borderColor=DA.red} onBlur={e => { if (!recording) e.target.style.borderColor=DA.border; }}/>
            {recording && (
              <p style={{ fontSize:11,fontStyle:'italic',margin:'4px 0 0',paddingLeft:2,lineHeight:1.4,color: interimText ? DA.black : DA.grayL }}>
                {interimText ? interimText + '…' : 'En écoute — parlez maintenant…'}
              </p>
            )}

            {/* Bouton dictée — grand, rouge, press-and-hold */}
            <button
              onPointerDown={(e) => { e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); if (!recording) startDictaphone(); }}
              onPointerUp={() => { if (recording) stopDictaphone(); }}
              onPointerCancel={() => { if (recording) stopDictaphone(); }}
              style={{ marginTop:8,width:'100%',padding:'13px 16px',borderRadius:10,border:'none',background:recording ? '#991b1b' : DA.red,color:'white',display:'flex',alignItems:'center',justifyContent:'center',gap:8,fontSize:14,fontWeight:700,cursor:'pointer',userSelect:'none',touchAction:'none',WebkitUserSelect:'none',transition:'background 0.15s',boxShadow:recording ? 'inset 0 2px 6px rgba(0,0,0,0.25)' : '0 2px 8px rgba(185,28,28,0.35)' }}>
              <Ic n={recording ? 'spn' : 'mic'} s={17}/>
              {recording ? 'Relâcher pour terminer' : 'Maintenir pour dicter'}
            </button>

            {/* Bouton corriger — apparaît sous la zone dès qu'il y a du texte */}
            {form.commentaire?.trim() && (
              <button onClick={fixSpelling} disabled={correcting}
                style={{ marginTop:6,width:'100%',padding:'9px 12px',borderRadius:8,border:`1.5px solid ${DA.border}`,background:'white',color:DA.gray,display:'flex',alignItems:'center',justifyContent:'center',gap:6,fontSize:12,fontWeight:600,cursor:'pointer',opacity: correcting ? 0.6 : 1 }}>
                {correcting ? <Ic n="spn" s={12}/> : <Ic n="chk" s={12}/>}
                {correcting ? 'Correction en cours…' : 'Corriger avec l\'IA'}
              </button>
            )}

            <IASug
              content={form.titre}
              onApply={text => setForm(f => ({ ...f, commentaire: f.commentaire ? f.commentaire + '\n— ' + text : text }))}
            />
          </div>

          {/* Photos */}
          <div style={{ marginBottom:14 }}>
            <div style={{ display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:8,gap:6,flexWrap:'wrap' }}>
              <label style={{ fontSize:12,fontWeight:600,color:DA.gray,textTransform:'uppercase',letterSpacing:0.5 }}>Photos ({form.photos.length})</label>
              <div style={{ display:'flex',gap:6,flexShrink:0 }}>
                <button onClick={() => gallRef.current.click()} style={{ fontSize:13,border:`1px solid ${DA.border}`,padding:'8px 12px',borderRadius:8,background:'white',color:DA.gray,display:'flex',alignItems:'center',gap:4,whiteSpace:'nowrap',cursor:'pointer' }}>
                  <Ic n="img" s={14}/> Galerie
                </button>
                <button onClick={() => { camRef.current.value=''; camRef.current.click(); }} style={{ fontSize:13,border:`1px solid ${DA.red}`,padding:'8px 12px',borderRadius:8,background:DA.red,color:'white',display:'flex',alignItems:'center',gap:4,whiteSpace:'nowrap',cursor:'pointer' }}>
                  <Ic n="cam" s={14}/> Photo
                </button>
              </div>
            </div>
            <input ref={gallRef} type="file" accept="image/*" multiple style={{ display:'none' }} onChange={e => readFiles(e.target.files)}/>
            <input ref={camRef} type="file" accept="image/*" capture="environment" style={{ display:'none' }}
              onChange={e => { if (e.target.files?.length) readFiles(e.target.files); setTimeout(() => { if(camRef.current) camRef.current.value=''; }, 200); }}/>

            {form.photos.length > 0 ? (
              <div style={{ display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:8 }}>
                {form.photos.map((ph, i) => (
                  <div key={i} style={{ position:'relative',aspectRatio:'1',borderRadius:8,overflow:'hidden' }}>
                    <img src={ph.data} alt="" style={{ width:'100%',height:'100%',objectFit:'cover' }}/>
                    <button onClick={() => setForm(f => ({ ...f, photos: f.photos.filter((_,j)=>j!==i) }))}
                      style={{ position:'absolute',top:4,right:4,background:'#E30513',color:'white',border:'none',borderRadius:'50%',width:20,height:20,display:'flex',alignItems:'center',justifyContent:'center',cursor:'pointer' }}>
                      <Ic n="x" s={10}/>
                    </button>
                  </div>
                ))}
                <button onClick={() => gallRef.current.click()} style={{ aspectRatio:'1',borderRadius:8,border:`2px dashed ${DA.border}`,background:'white',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:3,cursor:'pointer' }}>
                  <Ic n="img" s={15}/><span style={{ fontSize:9,color:DA.grayL }}>Galerie</span>
                </button>
                <button onClick={() => { camRef.current.value=''; camRef.current.click(); }} style={{ aspectRatio:'1',borderRadius:8,border:`2px dashed ${DA.red}`,background:DA.redL,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:3,cursor:'pointer' }}>
                  <Ic n="cam" s={15}/><span style={{ fontSize:9,color:DA.red,fontWeight:700 }}>Photo</span>
                </button>
              </div>
            ) : (
              <div style={{ display:'grid',gridTemplateColumns:'1fr 1fr',gap:8 }}>
                <div onClick={() => gallRef.current.click()} style={{ height:80,borderRadius:10,border:`2px dashed ${DA.border}`,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:4,cursor:'pointer',background:DA.grayXL }}>
                  <Ic n="img" s={20}/><span style={{ fontSize:11,color:DA.grayL }}>Galerie</span>
                </div>
                <div onClick={() => { camRef.current.value=''; camRef.current.click(); }} style={{ height:80,borderRadius:10,border:`2px dashed ${DA.red}`,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:4,cursor:'pointer',background:DA.redL }}>
                  <Ic n="cam" s={20}/><span style={{ fontSize:11,color:DA.red }}>Prendre photo</span>
                </div>
              </div>
            )}
          </div>

          {/* Plan */}
          <button onClick={() => setShowPlan(true)}
            style={{ width:'100%',border:`1px solid ${planBg?DA.red:DA.border}`,borderRadius:10,padding:10,fontSize:13,background:planBg?DA.redL:'white',color:planBg?DA.red:DA.gray,display:'flex',alignItems:'center',justifyContent:'center',gap:6,marginBottom:14,cursor:'pointer' }}>
            <Ic n="map" s={15}/>
            {planBg ? 'Consulter le plan de la zone' : 'Aucun plan pour cette zone'}
            {planAnnotations?.paths?.length > 0 && (
              <span style={{ marginLeft:'auto',fontSize:10,background:DA.redL,color:DA.red,borderRadius:10,padding:'2px 8px' }}>{planAnnotations.paths.length} annot.</span>
            )}
          </button>

          {compressing && (
            <div style={{ display:'flex',alignItems:'center',gap:8,padding:'8px 12px',background:'#F0FDF4',border:'1px solid #86EFAC',borderRadius:8,marginBottom:12 }}>
              <Ic n="spn" s={13}/>
              <span style={{ fontSize:12,color:'#15803D',fontWeight:600 }}>Traitement des photos…</span>
            </div>
          )}

          <button onClick={handleSave} disabled={!form.titre || compressing}
            style={{ width:'100%',background:form.titre&&!compressing?DA.black:'#ccc',color:'white',border:'none',borderRadius:10,padding:12,fontSize:14,fontWeight:700,cursor:form.titre&&!compressing?'pointer':'not-allowed',transition:'background 0.15s' }}>
            Enregistrer l'observation
          </button>
        </div>
      </div>
    </div>
  );
}
