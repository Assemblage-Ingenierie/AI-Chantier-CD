import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    rolldownOptions: {
      output: {
        // Découpage en paquets cacheables (Vite 8 / Rolldown : `codeSplitting` remplace
        // `manualChunks`, ignoré ou mal interprété ici — il faisait précharger l'onglet Rapport
        // au démarrage). Le poids parsé au démarrage reste minimal :
        //  - outils d'EXPORT (zip, PDF, capture d'image) : importés à la demande (import()),
        //    paquet séparé chargé seulement au premier export (check-up 02/11/2026) ;
        //  - bibliothèques : un paquet « vendor » stable entre deux déploiements ;
        //  - Rapport / Annotateur (~7 000 lignes) : paquet à part, mis en cache séparément.
        codeSplitting: {
          groups: [
            { name: 'export-libs', priority: 20, test: /node_modules[\\/](jszip|pdf-lib|@pdf-lib|html-to-image|pako|lie|immediate|setimmediate|readable-stream)[\\/]/ },
            { name: 'vendor', priority: 10, test: /node_modules/ },
            { name: 'report', priority: 5, test: /RapportPreview|Annotator/ },
          ],
        },
      },
    },
  },
});
