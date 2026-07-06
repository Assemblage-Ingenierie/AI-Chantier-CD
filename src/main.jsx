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

// ── Service worker — mise à jour SILENCIEUSE (jamais de reload pendant l'usage) ──
// Un reload forcé sur 'controllerchange' réinitialisait l'historique en plein usage
// → le bouton retour fermait l'app ("ça reset le truc"). On laisse donc le SW se
// mettre à jour en arrière-plan ; le nouveau code s'applique au prochain démarrage
// à froid de l'app. Les assets étant hashés (Vite) et le HTML servi en network-first,
// un lancement à froid récupère naturellement la dernière version.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').then(reg => {
      reg.update();
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') reg.update();
      });
    }).catch(() => {});
  });
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
