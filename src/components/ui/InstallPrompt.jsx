import React, { useState, useEffect } from 'react';

const LS_KEY = 'aichantier_install_dismissed';

function isIOS() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;
}
function isInStandaloneMode() {
  return window.navigator.standalone === true ||
    window.matchMedia('(display-mode: standalone)').matches;
}

export default function InstallPrompt() {
  const [show, setShow] = useState(false);
  const [isIos, setIsIos] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState(null);

  useEffect(() => {
    // Déjà installé ou déjà refusé → ne rien montrer
    if (isInStandaloneMode()) return;
    if (localStorage.getItem(LS_KEY)) return;

    const ios = isIOS();
    setIsIos(ios);

    if (ios) {
      // iOS : pas d'événement natif, on montre les instructions manuelles
      setShow(true);
    } else {
      // Android/Chrome : intercepter l'événement beforeinstallprompt
      const handler = (e) => {
        e.preventDefault();
        setDeferredPrompt(e);
        setShow(true);
      };
      window.addEventListener('beforeinstallprompt', handler);
      return () => window.removeEventListener('beforeinstallprompt', handler);
    }
  }, []);

  const dismiss = () => {
    localStorage.setItem(LS_KEY, '1');
    setShow(false);
  };

  const install = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') localStorage.setItem(LS_KEY, '1');
    setDeferredPrompt(null);
    setShow(false);
  };

  if (!show) return null;

  return (
    <div style={{
      position: 'fixed', bottom: 16, left: 16, right: 16, zIndex: 9999,
      background: '#1a1a1a', borderRadius: 16, padding: '16px 18px',
      boxShadow: '0 8px 32px rgba(0,0,0,0.45)',
      display: 'flex', flexDirection: 'column', gap: 12,
      border: '1px solid rgba(255,255,255,0.08)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <img src="/icon-192.png" alt="" style={{ width: 44, height: 44, borderRadius: 10, flexShrink: 0 }}/>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ color: 'white', fontWeight: 800, fontSize: 14 }}>Installer AIchantier</div>
          <div style={{ color: 'rgba(255,255,255,0.55)', fontSize: 12, marginTop: 2 }}>
            Accès rapide depuis votre écran d'accueil
          </div>
        </div>
        <button onClick={dismiss} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.4)', fontSize: 20, cursor: 'pointer', padding: 4, lineHeight: 1, flexShrink: 0 }}>×</button>
      </div>

      {isIos ? (
        <div style={{ background: 'rgba(255,255,255,0.07)', borderRadius: 10, padding: '10px 12px' }}>
          <div style={{ color: 'rgba(255,255,255,0.9)', fontSize: 12, lineHeight: 1.6 }}>
            Appuyez sur <strong style={{ color: 'white' }}>
              <svg style={{ width: 14, height: 14, verticalAlign: 'middle', fill: 'none', stroke: 'currentColor', strokeWidth: 2 }} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8M16 6l-4-4-4 4M12 2v13"/></svg>
              {' '}Partager
            </strong> en bas de Safari, puis <strong style={{ color: 'white' }}>"Sur l'écran d'accueil"</strong>
          </div>
          <button onClick={dismiss} style={{ marginTop: 10, width: '100%', padding: '9px 0', borderRadius: 8, border: 'none', background: 'rgba(255,255,255,0.12)', color: 'rgba(255,255,255,0.7)', fontSize: 13, cursor: 'pointer', fontWeight: 600 }}>
            Compris
          </button>
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={dismiss} style={{ flex: 1, padding: '10px 0', borderRadius: 10, border: '1px solid rgba(255,255,255,0.15)', background: 'transparent', color: 'rgba(255,255,255,0.6)', fontSize: 13, cursor: 'pointer', fontWeight: 600 }}>
            Plus tard
          </button>
          <button onClick={install} style={{ flex: 2, padding: '10px 0', borderRadius: 10, border: 'none', background: '#E30513', color: 'white', fontSize: 13, cursor: 'pointer', fontWeight: 800 }}>
            Installer l'app
          </button>
        </div>
      )}
    </div>
  );
}
