import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './styles.css';

// ── Service worker + mise à jour automatique ──────────────────────────────────
// Problème observé : la PWA installée gardait l'ancien code en cache et ne recevait
// jamais les nouvelles versions (reprise sans rechargement du document). On force
// désormais : détection d'une nouvelle version → activation immédiate → reload.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').then(reg => {
      // Une nouvelle version est trouvée → quand elle est installée, on l'active et on recharge.
      reg.addEventListener('updatefound', () => {
        const sw = reg.installing;
        if (!sw) return;
        sw.addEventListener('statechange', () => {
          if (sw.state === 'installed' && navigator.serviceWorker.controller) {
            // Nouveau SW prêt et un ancien contrôle déjà la page → on bascule.
            reg.waiting?.postMessage('skipWaiting');
          }
        });
      });
      // Vérifie les mises à jour au lancement et à chaque retour au premier plan.
      reg.update();
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') reg.update();
      });
    }).catch(() => {});

    // Quand le nouveau SW prend le contrôle, recharge une seule fois pour charger le code à jour.
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloaded) return;
      reloaded = true;
      // Trace dans le journal de diagnostic (persistant) pour repérer un reload intempestif.
      try {
        const prev = JSON.parse(localStorage.getItem('_navlog') || '[]');
        prev.push(`${new Date().toISOString().slice(17, 23)} *** RELOAD (controllerchange) ***`);
        localStorage.setItem('_navlog', JSON.stringify(prev.slice(-20)));
      } catch {}
      window.location.reload();
    });
  });
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
