import React, { useState, useEffect } from 'react';

const LS_KEY = 'aichantier_install_dismissed';

function isMobileDevice() {
  return /android|iphone|ipad|ipod|mobile/i.test(navigator.userAgent) || window.innerWidth < 768;
}
function isIOS() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;
}
function isStandalone() {
  return window.navigator.standalone === true ||
    window.matchMedia('(display-mode: standalone)').matches;
}

export default function InstallPrompt() {
  const [show, setShow]               = useState(false);
  const [mode, setMode]               = useState(''); // 'ios' | 'android-native' | 'android-manual'
  const [deferredPrompt, setDeferred] = useState(null);

  useEffect(() => {
    // Uniquement sur mobile
    if (!isMobileDevice()) return;
    // Déjà installé en standalone → pas besoin
    if (isStandalone()) return;
    // Déjà cliqué "Compris" ou "Plus tard"
    if (localStorage.getItem(LS_KEY)) return;

    if (isIOS()) {
      setMode('ios');
      setShow(true);
      return;
    }

    // Android/Chrome : attendre l'événement natif (3s max)
    let timer;
    const handler = (e) => {
      clearTimeout(timer);
      e.preventDefault();
      setDeferred(e);
      setMode('android-native');
      setShow(true);
    };
    window.addEventListener('beforeinstallprompt', handler);

    // Si l'événement ne vient pas (app déjà ajoutée comme raccourci ou navigateur non compatible)
    // → afficher les instructions manuelles Android après 3s
    timer = setTimeout(() => {
      setMode('android-manual');
      setShow(true);
    }, 3000);

    return () => {
      window.removeEventListener('beforeinstallprompt', handler);
      clearTimeout(timer);
    };
  }, []);

  const dismiss = () => {
    localStorage.setItem(LS_KEY, '1');
    setShow(false);
  };

  const installNative = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') localStorage.setItem(LS_KEY, '1');
    setDeferred(null);
    setShow(false);
  };

  if (!show) return null;

  // Icône partage iOS
  const ShareIcon = () => (
    <svg style={{ width:15,height:15,verticalAlign:'middle',display:'inline',flexShrink:0 }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/>
    </svg>
  );

  return (
    <div style={{
      position:'fixed', bottom:16, left:12, right:12, zIndex:9999,
      background:'#1C1C1E', borderRadius:18, padding:'16px 16px 14px',
      boxShadow:'0 12px 40px rgba(0,0,0,0.55)',
      display:'flex', flexDirection:'column', gap:12,
      border:'1px solid rgba(255,255,255,0.1)',
    }}>
      {/* En-tête */}
      <div style={{ display:'flex',alignItems:'center',gap:12 }}>
        <img src="/icon-192.png" alt="" style={{ width:46,height:46,borderRadius:11,flexShrink:0 }}/>
        <div style={{ flex:1,minWidth:0 }}>
          <div style={{ color:'white',fontWeight:800,fontSize:15 }}>Installer AIchantier</div>
          <div style={{ color:'rgba(255,255,255,0.5)',fontSize:12,marginTop:1 }}>Accès rapide depuis l'écran d'accueil</div>
        </div>
        <button onClick={dismiss} style={{ background:'none',border:'none',color:'rgba(255,255,255,0.35)',fontSize:22,cursor:'pointer',padding:'2px 6px',lineHeight:1,flexShrink:0 }}>×</button>
      </div>

      {/* iOS : instructions Partager */}
      {mode === 'ios' && (
        <div style={{ background:'rgba(255,255,255,0.08)',borderRadius:12,padding:'12px 14px',display:'flex',flexDirection:'column',gap:10 }}>
          <div style={{ display:'flex',alignItems:'flex-start',gap:10 }}>
            <span style={{ background:'#0A84FF',borderRadius:8,padding:'5px 8px',fontSize:12,fontWeight:700,color:'white',flexShrink:0,lineHeight:1 }}>1</span>
            <div style={{ color:'rgba(255,255,255,0.85)',fontSize:13,lineHeight:1.5 }}>
              Appuyez sur <strong style={{ color:'white' }}><ShareIcon/> Partager</strong> en bas de Safari
            </div>
          </div>
          <div style={{ display:'flex',alignItems:'flex-start',gap:10 }}>
            <span style={{ background:'#0A84FF',borderRadius:8,padding:'5px 8px',fontSize:12,fontWeight:700,color:'white',flexShrink:0,lineHeight:1 }}>2</span>
            <div style={{ color:'rgba(255,255,255,0.85)',fontSize:13,lineHeight:1.5 }}>
              Faites défiler et appuyez sur <strong style={{ color:'white' }}>"Sur l'écran d'accueil"</strong>
            </div>
          </div>
          <button onClick={dismiss} style={{ marginTop:2,padding:'10px 0',borderRadius:10,border:'none',background:'rgba(255,255,255,0.13)',color:'rgba(255,255,255,0.75)',fontSize:13,cursor:'pointer',fontWeight:700 }}>
            Compris ✓
          </button>
        </div>
      )}

      {/* Android natif : bouton direct */}
      {mode === 'android-native' && (
        <div style={{ display:'flex',gap:8 }}>
          <button onClick={dismiss} style={{ flex:1,padding:'11px 0',borderRadius:11,border:'1px solid rgba(255,255,255,0.15)',background:'transparent',color:'rgba(255,255,255,0.55)',fontSize:13,cursor:'pointer',fontWeight:600 }}>
            Plus tard
          </button>
          <button onClick={installNative} style={{ flex:2,padding:'11px 0',borderRadius:11,border:'none',background:'#E30513',color:'white',fontSize:14,cursor:'pointer',fontWeight:800 }}>
            Installer l'app
          </button>
        </div>
      )}

      {/* Android manuel : instructions Chrome */}
      {mode === 'android-manual' && (
        <div style={{ background:'rgba(255,255,255,0.08)',borderRadius:12,padding:'12px 14px',display:'flex',flexDirection:'column',gap:10 }}>
          <div style={{ display:'flex',alignItems:'flex-start',gap:10 }}>
            <span style={{ background:'#34C759',borderRadius:8,padding:'5px 8px',fontSize:12,fontWeight:700,color:'white',flexShrink:0,lineHeight:1 }}>1</span>
            <div style={{ color:'rgba(255,255,255,0.85)',fontSize:13,lineHeight:1.5 }}>
              Appuyez sur <strong style={{ color:'white' }}>⋮</strong> (3 points) en haut à droite de Chrome
            </div>
          </div>
          <div style={{ display:'flex',alignItems:'flex-start',gap:10 }}>
            <span style={{ background:'#34C759',borderRadius:8,padding:'5px 8px',fontSize:12,fontWeight:700,color:'white',flexShrink:0,lineHeight:1 }}>2</span>
            <div style={{ color:'rgba(255,255,255,0.85)',fontSize:13,lineHeight:1.5 }}>
              Appuyez sur <strong style={{ color:'white' }}>"Ajouter à l'écran d'accueil"</strong>
            </div>
          </div>
          <button onClick={dismiss} style={{ marginTop:2,padding:'10px 0',borderRadius:10,border:'none',background:'rgba(255,255,255,0.13)',color:'rgba(255,255,255,0.75)',fontSize:13,cursor:'pointer',fontWeight:700 }}>
            Compris ✓
          </button>
        </div>
      )}
    </div>
  );
}
