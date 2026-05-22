import React, { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
const isDesktop = typeof window !== 'undefined' && window.innerWidth >= 768;
import { DA, URGENCE, SUIVI } from '../../lib/constants.js';
import { renderMarkup } from '../../lib/markup.jsx';
import { Ic } from '../ui/Icons.jsx';
import IASug from './IASug.jsx';
import { callAIProxy } from '../../lib/aiProxy.js';
import Annotator from './Annotator.jsx';
import RichTextArea, { htmlToPlain } from '../ui/RichTextArea.jsx';

const DRAFT_KEY = (id) => `chantierai_draft_${id || 'new'}`;

async function uploadToDrive({ data, name, projetNom, visiteLabel, visiteDate }) {
  try {
    // data is a dataURL like "data:image/webp;base64,..."
    const [header, base64] = data.split(',');
    const mimeType = header.match(/:(.*?);/)?.[1] || 'image/webp';
    await fetch('/api/drive-upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ base64, mimeType, fileName: name, projetNom, visiteLabel, visiteDate }),
    });
  } catch { /* silently ignore — Drive upload is best-effort */ }
}

export default function ItemModal({ item, planBg, planAnnotations, onClose, onSave, onOpenAnnot, projetNom, visiteLabel, visiteDate }) {
  const [form, setForm] = useState(() => {
    const base = item
      ? { ...item, photos: (item.photos||[]).filter(ph => ph.data), suivi: item.suivi||'rien', commentaireAlign: item.commentaireAlign||'left' }
      : { titre:'', commentaire:'', urgence:'rien', photos:[], suivi:'rien', commentaireAlign:'left' };
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
  const draftJustMounted = useRef(true);
  const [showPlan, setShowPlan] = useState(false);
  const [annotatingPhotoIdx, setAnnotatingPhotoIdx] = useState(null);
  const [confirmDelPhotoIdx, setConfirmDelPhotoIdx] = useState(null);
  const [compressing, setCompressing] = useState(false);
  const [editorSyncKey, setEditorSyncKey] = useState(0);
  const bumpSync = () => setEditorSyncKey(k => k + 1);
  const [recording, setRecording] = useState(false);
  const [interimText, setInterimText] = useState('');
  const [correcting, setCorrecting] = useState(false);
  const [spellError, setSpellError] = useState('');
  const [spellDiff, setSpellDiff] = useState(null); // { original, corrected, tokens }
  const gallRef = useRef();
  const camRef = useRef();
  const textareaRef = useRef(); // ref vers RichTextArea (expose focus() et getEditor())
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

  // Auto-dismiss draft banner when user modifies the form (skip first render)
  useEffect(() => {
    if (draftJustMounted.current) { draftJustMounted.current = false; return; }
    if (draftRestored) setDraftRestored(false);
  }, [form.titre, form.commentaire]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const t = setTimeout(() => {
      try { localStorage.setItem(DRAFT_KEY(item?.id), JSON.stringify({ titre: form.titre, commentaire: form.commentaire, urgence: form.urgence, suivi: form.suivi, commentaireAlign: form.commentaireAlign })); } catch {}
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
        // No bumpSync here: isTyping is false during dictation so the value change
        // alone syncs the editor. bumpSync would trigger el.blur() which interrupts
        // iOS SpeechRecognition mid-session.
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

  // Construit des segments diff avec corrections individuellement toggleables
  const buildDiffSegments = (orig, corr) => {
    const wa = orig.split(/(\s+)/);
    const wb = corr.split(/(\s+)/);
    const n = wa.length, m = wb.length;
    const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
    for (let i = 1; i <= n; i++)
      for (let j = 1; j <= m; j++)
        dp[i][j] = wa[i-1] === wb[j-1] ? dp[i-1][j-1] + 1 : Math.max(dp[i-1][j], dp[i][j-1]);
    const tokens = [];
    let i = n, j = m;
    while (i > 0 || j > 0) {
      if (i > 0 && j > 0 && wa[i-1] === wb[j-1]) { tokens.unshift({ t:'eq', v:wb[j-1] }); i--; j--; }
      else if (j > 0 && (i === 0 || dp[i][j-1] >= dp[i-1][j])) { tokens.unshift({ t:'add', v:wb[j-1] }); j--; }
      else { tokens.unshift({ t:'del', v:wa[i-1] }); i--; }
    }
    // Grouper en segments : texte neutre ou correction toggleable
    const segs = [];
    let ci = 0, k = 0;
    while (k < tokens.length) {
      if (tokens[k].t === 'eq') {
        let text = '';
        while (k < tokens.length && tokens[k].t === 'eq') { text += tokens[k].v; k++; }
        segs.push({ type:'eq', text });
      } else {
        const dels = [], adds = [];
        while (k < tokens.length && tokens[k].t === 'del') { dels.push(tokens[k].v); k++; }
        while (k < tokens.length && tokens[k].t === 'add') { adds.push(tokens[k].v); k++; }
        segs.push({ type:'fix', id: ci++, del: dels.join(''), add: adds.join(''), active: true });
      }
    }
    return segs;
  };

  const toggleFix = (id) => setSpellDiff(d => ({
    ...d,
    segments: d.segments.map(s => s.type === 'fix' && s.id === id ? { ...s, active: !s.active } : s),
  }));

  const applyDiff = (all = false) => {
    const segs = all ? spellDiff.segments.map(s => s.type === 'fix' ? { ...s, active: true } : s) : spellDiff.segments;
    const plain = segs.map(s => s.type === 'eq' ? s.text : (s.active ? s.add : s.del)).join('');
    const html = plain.replace(/\n/g, '<br>');
    setForm(f => ({ ...f, commentaire: html }));
    setSpellDiff(null);
    bumpSync();
  };

  const fixSpelling = async () => {
    if (!form.commentaire?.trim() || correcting) return;
    setCorrecting(true);
    setSpellError('');
    setSpellDiff(null);
    try {
      const plain = htmlToPlain(form.commentaire);
      const d = await callAIProxy({
        feature: 'spell-correction',
        model: 'gemini-2.0-flash-lite',
        max_tokens: 2000,
        system: 'Tu es un correcteur orthographique et grammatical français. Corrige UNIQUEMENT les fautes d\'orthographe et de grammaire, sans rien reformuler, sans résumer, sans couper le texte. Le texte corrigé doit avoir exactement la même longueur et le même contenu que l\'original. Réponds UNIQUEMENT avec le texte intégral corrigé, sans guillemets ni explication.',
        messages: [{ role: 'user', content: plain }],
      });
      const corrected = d.content?.[0]?.text?.trim();
      const minLen = Math.floor(plain.length * 0.6);
      if (!corrected) throw new Error('Réponse vide du modèle');
      if (corrected.length < minLen) throw new Error('Réponse IA tronquée — réessaie');
      if (corrected === plain) {
        setSpellError('Aucune faute détectée ✓');
      } else {
        setSpellDiff({ original: plain, segments: buildDiffSegments(plain, corrected) });
      }
    } catch (e) { setSpellError(e.message || 'Erreur IA'); }
    setCorrecting(false);
  };

  const compressPhoto = (file) => new Promise(res => {
    const r = new FileReader();
    r.onerror = () => res(null);
    r.onload = ev => {
      const img = new Image();
      img.onerror = () => res(null);
      img.onload = () => {
        const MAX = 1600;
        let { width, height } = img;
        if (width > MAX || height > MAX) {
          if (width > height) { height = Math.round(height * MAX / width); width = MAX; }
          else { width = Math.round(width * MAX / height); height = MAX; }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width; canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        const name = file.name.replace(/\.[^.]+$/, '.webp');
        res({ data: canvas.toDataURL('image/webp', 0.82), name });
      };
      img.src = ev.target.result;
    };
    r.readAsDataURL(file);
  });

  const autoSaveToDevice = ({ data, name }) => {
    try {
      const a = document.createElement('a');
      a.href = data;
      a.download = name || `chantier_${Date.now()}.webp`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch { /* ignore */ }
  };

  const readFiles = (files, fromCamera = false) => {
    const filtered = Array.from(files).filter(f => {
      if (f.size > 25 * 1024 * 1024) { alert(`"${f.name}" est trop volumineux (max 25 Mo)`); return false; }
      return true;
    });
    if (!filtered.length) return;
    setCompressing(true);
    Promise.all(filtered.map(compressPhoto))
      .then(done => {
        const valid = done.filter(Boolean);
        setForm(prev => ({ ...prev, photos: [...prev.photos, ...valid] }));
        if (fromCamera) {
          valid.forEach(autoSaveToDevice);
          valid.forEach(ph => uploadToDrive({ ...ph, projetNom, visiteLabel, visiteDate }));
        }
      })
      .finally(() => setCompressing(false));
  };


  if (annotatingPhotoIdx !== null) {
    const ph = form.photos[annotatingPhotoIdx];
    return (
      <Annotator
        bgImage={ph?.data}
        savedPaths={ph?.annotations || []}
        onSave={(paths, exported, dims) => {
          setForm(f => ({
            ...f,
            photos: f.photos.map((p, i) => i === annotatingPhotoIdx ? { ...p, annotations: paths, annotated: exported, annotW: dims?.w, annotH: dims?.h } : p),
          }));
          setAnnotatingPhotoIdx(null);
        }}
        onClose={() => setAnnotatingPhotoIdx(null)}
      />
    );
  }

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

  const FMT_BTNS = [
    { label:'G', title:'Gras (Ctrl+B)',      cmd:'bold',      fw:800 },
    { label:'I', title:'Italique (Ctrl+I)',  cmd:'italic',    fi:'italic' },
    { label:'S', title:'Souligné (Ctrl+U)',  cmd:'underline', td:'underline' },
  ];
  const ALIGN_BTNS = [
    { k:'left',    sym:'←', title:'Aligner à gauche' },
    { k:'center',  sym:'↔', title:'Centrer' },
    { k:'right',   sym:'→', title:'Aligner à droite' },
    { k:'justify', sym:'☰', title:'Justifier' },
  ];

  // Inputs fichiers (hidden)
  const fileInputs = (
    <>
      <input ref={gallRef} type="file" accept="image/*" multiple style={{ display:'none' }} onChange={e => readFiles(e.target.files)}/>
      <input ref={camRef} type="file" accept="image/*" capture="environment" style={{ display:'none' }}
        onChange={e => { if (e.target.files?.length) readFiles(e.target.files, true); setTimeout(() => { if(camRef.current) camRef.current.value=''; }, 200); }}/>
    </>
  );

  return (
    <div className="modal-overlay" style={{ zIndex:40 }}>
      <div className="modal-sheet">
        <div style={{ padding: isDesktop ? '20px 24px' : 20 }}>

          {/* Header */}
          <div style={{ display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:draftRestored ? 8 : 16 }}>
            <p style={{ fontWeight:700,fontSize:15,color:DA.black }}>
              {item ? "Modifier l'observation" : 'Nouvelle observation'}
            </p>
            <button onClick={onClose} style={{ background:'none',border:'none',cursor:'pointer',color:DA.grayL,display:'flex',alignItems:'center',justifyContent:'center',padding:4 }}><Ic n="x" s={20}/></button>
          </div>
          {draftRestored && (
            <div style={{ display:'flex',alignItems:'center',gap:6,padding:'6px 10px',background:'#FFF7ED',border:'1px solid #FCD34D',borderRadius:8,marginBottom:14 }}>
              <span style={{ fontSize:11,color:'#92400E',fontWeight:600 }}>📝 Brouillon restauré</span>
              <button onClick={() => { setDraftRestored(false); try { localStorage.removeItem(DRAFT_KEY(item?.id)); } catch {} setForm(item ? { ...item, photos:(item.photos||[]).filter(ph=>ph.data), suivi:item.suivi||'rien', commentaireAlign: item.commentaireAlign||'left' } : { titre:'',commentaire:'',urgence:'rien',photos:[],suivi:'rien',commentaireAlign:'left' }); }}
                style={{ marginLeft:'auto',fontSize:10,color:'#92400E',background:'none',border:'1px solid #FCD34D',borderRadius:5,padding:'2px 7px',cursor:'pointer',fontWeight:600 }}>
                Ignorer
              </button>
            </div>
          )}

          {fileInputs}

          {/* Titre */}
          <div style={{ marginBottom:14 }}>
            <label style={{ display:'block',fontSize:12,fontWeight:600,color:DA.gray,marginBottom:6,textTransform:'uppercase',letterSpacing:0.5 }}>Intitulé *</label>
            <input value={form.titre} onChange={e => setForm(f => ({ ...f, titre: e.target.value }))}
              placeholder="Ex: Fissures, Humidité…"
              style={{ width:'100%',border:`1px solid ${DA.border}`,borderRadius:8,padding:'12px 14px',fontSize:15,outline:'none',boxSizing:'border-box' }}
              onFocus={e => e.target.style.borderColor=DA.red} onBlur={e => e.target.style.borderColor=DA.border}/>
          </div>

          {/* Niveau + Suivi — une seule ligne */}
          <div style={{ display:'flex',gap:8,marginBottom:14,overflowX:'auto' }}>
            {/* Groupe Niveau */}
            <div style={{ display:'inline-flex',alignItems:'center',gap:2,background:'#F8F8F8',border:`1px solid ${DA.border}`,borderRadius:10,padding:'5px 7px',flexShrink:0 }}>
              <span style={{ fontSize:10,fontWeight:800,color:DA.gray,textTransform:'uppercase',letterSpacing:0.8,paddingRight:6,paddingLeft:2,whiteSpace:'nowrap',borderRight:`1px solid ${DA.border}`,marginRight:4 }}>Niveau</span>
              {Object.entries(URGENCE).map(([k, u]) => {
                const on = form.urgence === k;
                return (
                  <button key={k} onClick={() => setForm(f => ({ ...f, urgence: k }))}
                    style={{ padding:'4px 9px',borderRadius:6,fontSize:12,fontWeight:on?700:500,border:'none',background:on?u.dot:'transparent',color:on?'white':'#777',cursor:'pointer',whiteSpace:'nowrap',flexShrink:0,display:'flex',alignItems:'center',gap:3 }}>
                    {!on && <span style={{ width:5,height:5,borderRadius:'50%',background:u.dot,flexShrink:0 }}/>}
                    {u.label}
                  </button>
                );
              })}
            </div>
            {/* Groupe Suivi */}
            <div style={{ display:'inline-flex',alignItems:'center',gap:2,background:'#F8F8F8',border:`1px solid ${DA.border}`,borderRadius:10,padding:'5px 7px',flexShrink:0 }}>
              <span style={{ fontSize:10,fontWeight:800,color:DA.gray,textTransform:'uppercase',letterSpacing:0.8,paddingRight:6,paddingLeft:2,whiteSpace:'nowrap',borderRight:`1px solid ${DA.border}`,marginRight:4 }}>Suivi</span>
              {Object.entries(SUIVI).map(([k, s]) => {
                const on = form.suivi === k;
                return (
                  <button key={k} onClick={() => setForm(f => ({ ...f, suivi: k }))}
                    style={{ padding:'4px 9px',borderRadius:6,fontSize:12,fontWeight:on?700:500,border:'none',background:on?s.dot:'transparent',color:on?'white':'#777',cursor:'pointer',whiteSpace:'nowrap',flexShrink:0,display:'flex',alignItems:'center',gap:3 }}>
                    {!on && <span style={{ width:5,height:5,borderRadius:'50%',background:s.dot,flexShrink:0 }}/>}
                    {s.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Commentaire — pleine largeur */}
          <div style={{ marginBottom:14 }}>
            <label style={{ display:'block',fontSize:12,fontWeight:600,color:DA.gray,textTransform:'uppercase',letterSpacing:0.5,marginBottom:6 }}>Commentaire</label>

            {/* Toolbar : G/I/S + séparateur + alignements */}
            <div style={{ display:'flex',gap:3,marginBottom:0,alignItems:'center',flexWrap:'wrap',padding:'6px 8px',background:'#F8F8F8',border:`1px solid ${DA.border}`,borderRadius:'8px 8px 0 0',borderBottom:'none' }}>
              {FMT_BTNS.map(btn => (
                <button key={btn.label} type="button" title={btn.title}
                  onMouseDown={e => { e.preventDefault(); document.execCommand(btn.cmd); textareaRef.current?.getEditor()?.focus(); }}
                  style={{ width:30,height:28,borderRadius:5,border:`1px solid ${DA.border}`,background:'white',color:DA.black,fontSize:13,fontWeight:btn.fw??400,fontStyle:btn.fi??'normal',textDecoration:btn.td??'none',cursor:'pointer',userSelect:'none',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0 }}>
                  {btn.label}
                </button>
              ))}
              <div style={{ width:1,height:20,background:DA.border,margin:'0 4px',flexShrink:0 }}/>
              {ALIGN_BTNS.map(a => (
                <button key={a.k} type="button" title={a.title}
                  onMouseDown={e => { e.preventDefault(); setForm(f => ({ ...f, commentaireAlign: a.k })); }}
                  style={{ width:30,height:28,borderRadius:5,fontSize:14,cursor:'pointer',flexShrink:0,
                    border:`1.5px solid ${form.commentaireAlign===a.k ? DA.red : DA.border}`,
                    background: form.commentaireAlign===a.k ? DA.redL : 'white',
                    color: form.commentaireAlign===a.k ? DA.red : DA.gray,
                    display:'flex',alignItems:'center',justifyContent:'center' }}>
                  {a.sym}
                </button>
              ))}
            </div>

            <RichTextArea
              ref={textareaRef}
              value={form.commentaire || ''}
              syncKey={editorSyncKey}
              onChange={val => setForm(f => ({ ...f, commentaire: val }))}
              placeholder="Description détaillée — fissures, localisation précise, préconisations, réserves…"
              textAlign={form.commentaireAlign || 'left'}
              style={{ width:'100%', border:`1px solid ${recording ? DA.red : DA.border}`, borderRadius:'0 0 8px 8px', padding:'12px 14px', fontSize:15, lineHeight:1.7, minHeight: isDesktop ? 260 : 90, boxSizing:'border-box', fontFamily:'inherit' }}
              onFocus={() => { if (textareaRef.current?.getEditor()) textareaRef.current.getEditor().style.borderColor = DA.red; }}
              onBlur={() => { if (!recording && textareaRef.current?.getEditor()) textareaRef.current.getEditor().style.borderColor = DA.border; }}
            />

            {recording && (
              <p style={{ fontSize:11,fontStyle:'italic',margin:'4px 0 0',lineHeight:1.4,color: interimText ? DA.black : DA.grayL }}>
                {interimText ? interimText + '…' : 'En écoute — parlez maintenant…'}
              </p>
            )}

            <div style={{ display:'flex',gap:8,marginTop:8 }}>
              <button
                onPointerDown={e => { e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); if (!recording) startDictaphone(); }}
                onPointerUp={() => { if (recording) stopDictaphone(); }}
                onPointerCancel={() => { if (recording) stopDictaphone(); }}
                style={{ flex:1,padding:'12px 14px',borderRadius:10,border:'none',background:recording ? '#991b1b' : DA.red,color:'white',display:'flex',alignItems:'center',justifyContent:'center',gap:8,fontSize:14,fontWeight:700,cursor:'pointer',userSelect:'none',touchAction:'none',WebkitUserSelect:'none',transition:'background 0.15s',boxShadow:recording?'inset 0 2px 6px rgba(0,0,0,0.25)':'0 2px 8px rgba(185,28,28,0.35)' }}>
                <Ic n={recording ? 'spn' : 'mic'} s={16}/>
                {recording ? 'Relâcher pour terminer' : 'Maintenir pour dicter'}
              </button>
              {form.commentaire?.trim() && (
                <button onClick={fixSpelling} disabled={correcting}
                  style={{ padding:'12px 14px',borderRadius:10,border:`1.5px solid ${DA.border}`,background:'white',color:DA.gray,display:'flex',alignItems:'center',gap:6,fontSize:13,fontWeight:600,cursor:'pointer',opacity:correcting?0.6:1,whiteSpace:'nowrap',flexShrink:0 }}>
                  {correcting ? <Ic n="spn" s={13}/> : <Ic n="chk" s={13}/>}
                  {correcting ? 'Correction…' : isDesktop ? "Corriger avec l'IA" : 'Corriger IA'}
                </button>
              )}
            </div>

            {spellError && (
              <div style={{ marginTop:6,padding:'7px 10px',background: spellError.includes('✓') ? '#F0FDF4' : '#FEF2F2',border:`1px solid ${spellError.includes('✓') ? '#BBF7D0' : '#FECACA'}`,borderRadius:8,fontSize:12,color:spellError.includes('✓') ? '#15803D' : '#B91C1C' }}>
                {spellError}
              </div>
            )}

            {spellDiff && (() => {
              const fixes = spellDiff.segments.filter(s => s.type === 'fix');
              const activeCount = fixes.filter(s => s.active).length;
              return (
                <div style={{ marginTop:8, border:'1px solid #E5E7EB', borderRadius:10, overflow:'hidden', fontSize:12 }}>
                  {/* Barre d'en-tête */}
                  <div style={{ background:'#F9FAFB', padding:'8px 12px', display:'flex', alignItems:'center', justifyContent:'space-between', borderBottom:'1px solid #E5E7EB', gap:8, flexWrap:'wrap' }}>
                    <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                      <span style={{ fontWeight:700, color:'#374151', fontSize:11, textTransform:'uppercase', letterSpacing:0.5 }}>Corrections proposées</span>
                      <span style={{ fontSize:11, color:'#6B7280' }}>{activeCount}/{fixes.length} sélectionnée{activeCount !== 1 ? 's' : ''}</span>
                    </div>
                    <div style={{ display:'flex', gap:6 }}>
                      <button onClick={() => setSpellDiff(d => ({ ...d, segments: d.segments.map(s => s.type === 'fix' ? { ...s, active: true } : s) }))}
                        style={{ background:'white', color:'#374151', border:'1px solid #D1D5DB', borderRadius:6, padding:'4px 10px', fontSize:11, fontWeight:600, cursor:'pointer' }}>
                        Tout
                      </button>
                      <button onClick={() => setSpellDiff(d => ({ ...d, segments: d.segments.map(s => s.type === 'fix' ? { ...s, active: false } : s) }))}
                        style={{ background:'white', color:'#6B7280', border:'1px solid #D1D5DB', borderRadius:6, padding:'4px 10px', fontSize:11, fontWeight:600, cursor:'pointer' }}>
                        Aucune
                      </button>
                      <button onClick={() => applyDiff()}
                        disabled={activeCount === 0}
                        style={{ background: activeCount > 0 ? '#059669' : '#9CA3AF', color:'white', border:'none', borderRadius:6, padding:'4px 12px', fontSize:11, fontWeight:700, cursor: activeCount > 0 ? 'pointer' : 'default' }}>
                        ✓ Appliquer ({activeCount})
                      </button>
                      <button onClick={() => setSpellDiff(null)}
                        style={{ background:'white', color:'#6B7280', border:'1px solid #D1D5DB', borderRadius:6, padding:'4px 10px', fontSize:11, fontWeight:600, cursor:'pointer' }}>
                        ✕
                      </button>
                    </div>
                  </div>
                  {/* Légende */}
                  <div style={{ background:'#FFFBEB', padding:'5px 12px', borderBottom:'1px solid #FDE68A', fontSize:10, color:'#92400E' }}>
                    Clique sur une correction pour la sélectionner / désélectionner
                  </div>
                  {/* Texte avec corrections */}
                  <div style={{ padding:'10px 12px', lineHeight:1.9, color:'#1F2937', background:'white' }}>
                    {spellDiff.segments.map((seg, i) => {
                      if (seg.type === 'eq') return <span key={i}>{seg.text}</span>;
                      const on = seg.active;
                      return (
                        <span key={i}
                          onClick={() => toggleFix(seg.id)}
                          title={on ? 'Cliquer pour ignorer cette correction' : 'Cliquer pour accepter cette correction'}
                          style={{ cursor:'pointer', borderRadius:3, padding:'1px 2px', border: on ? '1px solid transparent' : '1px dashed #D1D5DB', background: on ? 'transparent' : '#F9FAFB', display:'inline' }}>
                          {on ? (
                            <>
                              {seg.del && <span style={{ background:'#FEE2E2', color:'#991B1B', textDecoration:'line-through', borderRadius:2, padding:'0 2px', marginRight:1 }}>{seg.del}</span>}
                              {seg.add && <span style={{ background:'#DCFCE7', color:'#166534', fontWeight:700, borderRadius:2, padding:'0 2px' }}>{seg.add}</span>}
                            </>
                          ) : (
                            <span style={{ color:'#9CA3AF', textDecoration:'line-through' }}>{seg.del || seg.add}</span>
                          )}
                        </span>
                      );
                    })}
                  </div>
                </div>
              );
            })()}

            <IASug
              content={form.titre}
              commentaire={form.commentaire}
              photos={form.photos}
              onApply={text => { setForm(f => ({ ...f, commentaire: f.commentaire ? f.commentaire + '\n' + text : text })); bumpSync(); }}
              onApplyTitle={title => setForm(f => ({ ...f, titre: title }))}
              onApplyUrgence={urgence => setForm(f => ({ ...f, urgence }))}
            />
          </div>

          {/* Photos — pleine largeur */}
          <div style={{ marginBottom:14 }}>
            <div style={{ display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:8,gap:6,flexWrap:'wrap' }}>
              <label style={{ fontSize:12,fontWeight:600,color:DA.gray,textTransform:'uppercase',letterSpacing:0.5 }}>Photos ({form.photos.length})</label>
              <div style={{ display:'flex',gap:6,flexShrink:0 }}>
                <button onClick={() => gallRef.current.click()} style={{ fontSize:13,border:`1px solid ${DA.border}`,padding:'8px 12px',borderRadius:8,background:'white',color:DA.gray,display:'flex',alignItems:'center',gap:4,cursor:'pointer' }}>
                  <Ic n="img" s={14}/> Galerie
                </button>
                <button onClick={() => { camRef.current.value=''; camRef.current.click(); }} style={{ fontSize:13,border:`1px solid ${DA.red}`,padding:'8px 12px',borderRadius:8,background:DA.red,color:'white',display:'flex',alignItems:'center',gap:4,cursor:'pointer' }}>
                  <Ic n="cam" s={14}/> Photo
                </button>
              </div>
            </div>
            {form.photos.length > 0 ? (
              <div style={{ display:'grid',gridTemplateColumns: isDesktop ? 'repeat(5,1fr)' : 'repeat(3,1fr)',gap:8 }}>
                {form.photos.map((ph, i) => (
                  <div key={i} style={{ position:'relative',aspectRatio:'1',borderRadius:8,overflow:'hidden' }}>
                    <img src={ph.annotated || ph.data} alt="" style={{ width:'100%',height:'100%',objectFit:'cover' }}/>
                    {(
                      <button onClick={() => setConfirmDelPhotoIdx(i)}
                        style={{ position:'absolute',top:4,right:4,background:'#E30513',color:'white',border:'none',borderRadius:'50%',width:20,height:20,display:'flex',alignItems:'center',justifyContent:'center',cursor:'pointer' }}>
                        <Ic n="x" s={10}/>
                      </button>
                    )}
                    <button onClick={() => setAnnotatingPhotoIdx(i)}
                      title="Annoter"
                      style={{ position:'absolute',bottom:4,right:4,background: ph.annotations?.length ? DA.red : 'rgba(0,0,0,0.55)',color:'white',border:'none',borderRadius:'50%',width:22,height:22,display:'flex',alignItems:'center',justifyContent:'center',cursor:'pointer' }}>
                      <Ic n="pen" s={11}/>
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

          {compressing && (
            <div style={{ display:'flex',alignItems:'center',gap:8,padding:'8px 12px',background:'#F0FDF4',border:'1px solid #86EFAC',borderRadius:8,marginBottom:12 }}>
              <Ic n="spn" s={13}/>
              <span style={{ fontSize:12,color:'#15803D',fontWeight:600 }}>Traitement des photos…</span>
            </div>
          )}

          {/* Vignette plan */}
          {planBg && (
            <div style={{ marginBottom:14 }}>
              <div style={{ display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:8 }}>
                <label style={{ fontSize:12,fontWeight:600,color:DA.gray,textTransform:'uppercase',letterSpacing:0.5 }}>
                  Plan
                  {planAnnotations?.paths?.length > 0 && (
                    <span style={{ marginLeft:6,fontSize:10,background:DA.redL,color:DA.red,borderRadius:10,padding:'2px 7px',border:`1px solid #FECACA` }}>
                      {planAnnotations.paths.length} annotation{planAnnotations.paths.length > 1 ? 's' : ''}
                    </span>
                  )}
                </label>
                <button onClick={() => onOpenAnnot(form)}
                  style={{ fontSize:12,fontWeight:600,color:DA.red,background:DA.redL,border:`1px solid #FECACA`,borderRadius:8,padding:'5px 12px',cursor:'pointer',display:'flex',alignItems:'center',gap:5 }}>
                  <Ic n="pen" s={12}/> Annoter
                </button>
              </div>
              <div onClick={() => onOpenAnnot(form)}
                style={{ position:'relative',borderRadius:10,overflow:'hidden',border:`1px solid ${DA.border}`,cursor:'pointer',background:'#1a1a1a' }}>
                <img src={planAnnotations?.exported || planBg} alt="Plan"
                  style={{ width:'100%',maxHeight: isDesktop ? 220 : 160,objectFit:'contain',display:'block' }}/>
                <div style={{ position:'absolute',bottom:0,left:0,right:0,padding:'6px 10px',background:'linear-gradient(transparent,rgba(0,0,0,0.55))',display:'flex',alignItems:'center',gap:5 }}>
                  <Ic n="pen" s={11} color="white"/>
                  <span style={{ fontSize:11,color:'white',fontWeight:600 }}>Cliquer pour annoter</span>
                </div>
              </div>
            </div>
          )}

          {/* Enregistrer */}
          <div style={{ display:'flex',gap:8,alignItems:'stretch' }}>
            {!planBg && (
              <button onClick={() => setShowPlan(true)}
                style={{ border:`1px solid ${DA.border}`,borderRadius:10,padding:'12px 14px',fontSize:13,background:'white',color:DA.gray,display:'flex',alignItems:'center',gap:6,cursor:'pointer',flexShrink:0,whiteSpace:'nowrap' }}>
                <Ic n="map" s={15}/> Plan (vide)
              </button>
            )}
            <button onClick={handleSave} disabled={!form.titre || compressing}
              style={{ flex:1,background:form.titre&&!compressing?DA.black:'#ccc',color:'white',border:'none',borderRadius:10,padding:12,fontSize:15,fontWeight:700,cursor:form.titre&&!compressing?'pointer':'not-allowed' }}>
              Enregistrer l'observation
            </button>
          </div>

        </div>
      </div>

      {/* Action sheet suppression photo — couvre l'écran, boutons larges */}
      {confirmDelPhotoIdx !== null && (
        <div style={{ position:'fixed', inset:0, zIndex:200, display:'flex', flexDirection:'column', justifyContent:'flex-end' }}
          onClick={() => setConfirmDelPhotoIdx(null)}>
          <div style={{ background:'white', borderRadius:'20px 20px 0 0', padding:'20px 16px 36px', boxShadow:'0 -8px 32px rgba(0,0,0,0.18)' }}
            onClick={e => e.stopPropagation()}>
            <div style={{ width:36, height:4, background:'#DDD', borderRadius:2, margin:'0 auto 18px' }}/>
            <p style={{ textAlign:'center', fontSize:13, color:DA.gray, margin:'0 0 16px', fontWeight:600 }}>Supprimer cette photo ?</p>
            <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
              <button onClick={() => { setForm(f => ({ ...f, photos: f.photos.filter((_,j) => j !== confirmDelPhotoIdx) })); setConfirmDelPhotoIdx(null); }}
                style={{ width:'100%', padding:'15px', background:'#B91C1C', color:'white', border:'none', borderRadius:12, fontSize:16, fontWeight:800, cursor:'pointer' }}>
                Supprimer
              </button>
              <button onClick={() => setConfirmDelPhotoIdx(null)}
                style={{ width:'100%', padding:'15px', background:'#F5F5F5', color:'#333', border:'none', borderRadius:12, fontSize:16, fontWeight:600, cursor:'pointer' }}>
                Annuler
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
