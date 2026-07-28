import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './styles.css';
import { installGlobalErrorHandlers } from './lib/logger.js';

// Capture les erreurs hors rendu React (rejets de promesses, erreurs de sync) que
// l'ErrorBoundary ne voit pas → remontée serveur via /api/log.
installGlobalErrorHandlers();

// ── Anti-fermeture par le bouton retour (Android) / geste retour (iOS) ──────────
// Le tampon de sentinelles d'historique de ChantierAI ne s'arme qu'au MONTAGE React :
// pendant le splash/chargement (ou après un gel Android qui a vidé l'historique),
// l'historique n'a qu'une entrée → un appui retour SORT de l'app (« retour 2x très
// vite → ça ferme l'appli »). On arme donc un premier tampon IMMÉDIATEMENT, avant
// React : le popstate de ChantierAI prendra le relais dès son montage. Un retour
// avant React ne fait alors que consommer une sentinelle (aucune navigation).
try {
  history.replaceState({ pwaSentinel: true }, '');
  for (let i = 0; i < 25; i++) history.pushState({ pwaSentinel: true }, '');
} catch { /* Safari privé / throttle — le tampon de ChantierAI reprendra au montage */ }

// ── Service worker — mise à jour AUTOMATIQUE ────────────────────────────────────
// INCIDENT 2026-07-28 : l'ancienne stratégie « mise à jour silencieuse, jamais de
// reload » laissait les utilisateurs bloqués des jours sur une VIEILLE version en
// cache (aucune correction ne leur parvenait). On applique désormais le nouveau code
// dès qu'il est prêt : le nouveau SW (skipWaiting côté sw.js) prend le contrôle, ce
// qui déclenche 'controllerchange' → un reload UNIQUE (garde `refreshing`). Le tampon
// anti-retour (ci-dessus) se ré-arme à chaque chargement → le bouton retour reste sûr,
// et les données sont sauvegardées en continu (localStorage + boîte noire) → reload sans risque.
if ('serviceWorker' in navigator) {
  let refreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (refreshing) return;
    refreshing = true;
    window.location.reload();
  });
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').then(reg => {
      reg.update();
      if (reg.waiting) reg.waiting.postMessage('skipWaiting'); // MAJ déjà en attente → l'activer
      reg.addEventListener('updatefound', () => {
        const nw = reg.installing;
        nw?.addEventListener('statechange', () => {
          if (nw.state === 'installed' && navigator.serviceWorker.controller) nw.postMessage('skipWaiting');
        });
      });
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') reg.update();
      });
    }).catch(() => {});
  });
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
