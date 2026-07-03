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
          // Un seul chunk vendor (éviter les cycles react/scheduler ↔ analytics).
          if (id.includes('node_modules')) return 'vendor';
          if (/RapportPreview|Annotator|generateRapport/.test(id)) return 'report';
        },
      },
    },
  },
});
