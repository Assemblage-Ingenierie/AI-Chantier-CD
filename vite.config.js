import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        // Découpage en chunks cacheables (audit annexe). Zéro changement de code :
        // séparer les dépendances et les gros composants (rapport/annotateur, ~5000 lignes)
        // du chunk principal réduit le poids parsé au démarrage et améliore la mise en cache
        // (le vendor ne change pas entre deux déploiements applicatifs).
        manualChunks(id) {
          // Outils d'EXPORT (zip, PDF, capture d'image) : déjà importés à la demande dans le code
          // (import()) → chunk séparé, chargé seulement au premier export. Avant, tout node_modules
          // allait dans « vendor » chargé au démarrage, ce qui annulait ce chargement différé
          // (check-up 02/11/2026 : ~100 Ko compressés de moins au démarrage).
          if (/node_modules\/(jszip|pdf-lib|@pdf-lib|html-to-image|pako|lie|immediate|setimmediate|readable-stream)\//.test(id)) return 'export-libs';
          // Un seul chunk vendor (éviter les cycles react/scheduler ↔ analytics).
          if (id.includes('node_modules')) return 'vendor';
          if (/RapportPreview|Annotator/.test(id)) return 'report';
        },
      },
    },
  },
});
