import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './styles.css';

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
