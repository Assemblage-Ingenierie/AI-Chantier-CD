# ChantierAI

Application web de gestion de visites chantier pour bureau d'études techniques.  
Développée par **Assemblage Ingénierie**.

---

## Infrastructure

| Couche | Technologie |
|--------|-------------|
| **Frontend** | React 18 + Vite |
| **Déploiement** | Vercel |
| **Base de données** | Supabase (PostgreSQL) |
| **Authentification** | Supabase Auth |
| **API serverless** | Vercel Functions (`/api/`) |
| **IA** | Claude (Anthropic) via proxy sécurisé |

> **Note** : L'ancien prototype utilisait un seul `index.html` déployé sur GitHub Pages.  
> Ce dépôt est désormais une application React modulaire déployée sur **Vercel**, avec une base de données **Supabase** et des fonctions serverless pour la sécurité.

---

## Arborescence

```
AI-Chantier-CD/
│
├── api/                          # Fonctions serverless Vercel
│   ├── config.js                 # Expose l'URL et la clé publique Supabase au frontend
│   ├── ai.js                     # Proxy sécurisé vers l'API Claude (Anthropic)
│   └── state.js                  # (legacy) Ancienne route REST — remplacé par SDK Supabase
│
├── src/
│   ├── main.jsx                  # Point d'entrée React — monte <App /> dans #root
│   ├── App.jsx                   # Racine : ErrorBoundary → AuthGate
│   ├── styles.css                # CSS global (reset, police Inter, scrollbar)
│   ├── supabase.js               # Client Supabase singleton (initialisé depuis /api/config)
│   │
│   ├── hooks/
│   │   ├── useAuth.js            # Machine à états auth : loading / loggedout / waiting / approved
│   │   └── useProjets.js         # État global des projets + sauvegarde automatique avec debounce
│   │
│   ├── lib/
│   │   ├── constants.js          # Design tokens : couleurs (DA), niveaux urgence, états suivi
│   │   ├── aiProxy.js            # Appel /api/ai-proxy avec token Bearer automatique
│   │   ├── pdfUtils.js           # Chargement PDF.js (CDN) + rendu de pages PDF en image
│   │   └── storage.js            # Persistence multi-niveaux : Supabase → localStorage → mémoire
│   │
│   └── components/
│       │
│       ├── app/
│       │   ├── ChantierAI.jsx    # Shell principal après connexion : header, sync status, routing
│       │   └── VueProjet.jsx     # Vue détail d'un projet : zones, observations, récap, plans
│       │
│       ├── auth/
│       │   ├── AuthGate.jsx      # Aiguilleur selon l'état auth (login / attente / app)
│       │   ├── LoginScreen.jsx   # Formulaire : email+mdp, Google OAuth, lien magique
│       │   ├── WaitingScreen.jsx # Écran d'attente d'approbation admin
│       │   └── AdminPanel.jsx    # Gestion des utilisateurs (approbation, rôles)
│       │
│       ├── dashboard/
│       │   ├── Dashboard.jsx     # Liste des projets actifs + archivés + stats
│       │   ├── ProjectCard.jsx   # Carte projet avec menu (archiver, supprimer)
│       │   ├── NewProjet.jsx     # Modal de création d'un projet
│       │   └── PhotoModal.jsx    # Modal de changement de photo de projet
│       │
│       ├── vue/                  # Composants de la vue détail projet
│       │   ├── SortList.jsx      # Liste d'observations draggable avec mode tri
│       │   ├── ItemModal.jsx     # Formulaire observation : titre, urgence, suivi, photos, plan, IA
│       │   ├── IASug.jsx         # Suggestion IA pour reformuler une observation (Claude)
│       │   ├── TableauRecap.jsx  # Tableau récapitulatif avec génération IA automatique
│       │   ├── Annotator.jsx     # Outil d'annotation sur canvas (stylo, gomme, texte, symboles)
│       │   ├── PlanLibraryModal.jsx  # Bibliothèque de plans du projet (PDF/image)
│       │   ├── PlanLocModal.jsx  # Assignation d'un plan à une zone + annotation
│       │   └── PdfPagePicker.jsx # Sélection d'une page dans un PDF multi-pages
│       │
│       └── ui/
│           ├── Icons.jsx         # Bibliothèque d'icônes SVG inline + Badge urgence + BadgeSuivi
│           ├── EditTitle.jsx     # Composant titre éditable en place (double-clic)
│           └── ErrorBoundary.jsx # Filet de sécurité React pour les erreurs de rendu
│
├── index.html                    # Point d'entrée HTML (SPA — une seule page)
├── index.legacy.html             # Archive de l'ancien prototype monolithique
├── vite.config.js                # Configuration Vite + plugin React
├── vercel.json                   # Configuration déploiement Vercel
└── package.json                  # Dépendances : react, react-dom, @supabase/supabase-js
```

---

## Fonctionnement du code

### 1. Démarrage et authentification

```
main.jsx → App.jsx → ErrorBoundary → AuthGate → useAuth()
```

`useAuth()` initialise la session Supabase au chargement, puis écoute les changements d'état auth.  
`AuthGate` affiche l'écran correspondant selon l'état :

| État | Écran affiché |
|------|--------------|
| `loading` | Spinner de chargement |
| `loggedout` | `LoginScreen` (email/mdp, Google, lien magique) |
| `waiting` | `WaitingScreen` (compte en attente d'approbation admin) |
| `approved` | `ChantierAI` (application principale) |

L'approbation est gérée via la table `profiles` dans Supabase : un admin passe `is_approved = true` via l'`AdminPanel`.

---

### 2. Gestion des projets et sauvegarde

```
ChantierAI → useProjets() → storage.js → Supabase
```

`useProjets()` maintient l'état de tous les projets en mémoire React.  
À chaque modification, une sauvegarde est déclenchée **avec un délai de 2 secondes** (debounce) pour éviter les appels excessifs. Si l'utilisateur ferme l'onglet, une sauvegarde immédiate est déclenchée via `beforeunload`.

**Hiérarchie de stockage dans `storage.js`** :

```
Lecture  : Supabase (prioritaire) → localStorage (fallback) → mémoire
Écriture : localStorage (immédiat) + Supabase (asynchrone en arrière-plan)
```

Les images et PDFs (blobs) sont stockés séparément dans la table `app_blob_store` et référencés par des clés dans l'état principal (`app_state_store`).

---

### 3. Navigation (sans routeur)

L'application n'utilise pas React Router. La navigation est gérée par l'état local :

```
ChantierAI
  ├── ouvert === null  →  Dashboard (liste des projets)
  └── ouvert !== null  →  VueProjet (détail du projet sélectionné)
```

`VueProjet` gère à son tour ses propres modals (ItemModal, PlanLocModal, Annotator, PlanLibraryModal) via un état `modal` centralisé.

---

### 4. Vue projet — flux de données

```
VueProjet
  ├── Tab "Visite"
  │     └── par zone (localisation)
  │           ├── SortList → ItemModal (création/édition observation)
  │           │     └── IASug (suggestion IA via Claude)
  │           │     └── Annotator (annotation plan de l'observation)
  │           └── PlanLocModal → PlanLibraryModal / Annotator (plan de zone)
  └── Tab "Récap"
        └── TableauRecap (tableau avec génération IA automatique)
```

**Structure d'un projet** :
```js
{
  id: "uuid",
  nom: "Résidence Les Acacias",
  adresse: "12 rue...",
  maitreOuvrage: "Ville de Lyon",
  photo: null,           // base64 ou null
  statut: "en_cours",    // "en_cours" | "archive"
  planLibrary: [],       // [{id, nom, bg (image), data (PDF)}]
  tableauRecap: [],      // lignes du tableau récapitulatif
  localisations: [       // zones de visite
    {
      id: "uuid",
      nom: "Rez-de-chaussée",
      planBg: null,          // image du plan de zone
      planAnnotations: null, // annotations globales de la zone
      items: [               // observations
        {
          id: "uuid",
          titre: "Fissures en façade",
          commentaire: "...",
          urgence: "haute",   // "haute" | "moyenne" | "basse"
          suivi: "a_faire",   // "rien" | "a_faire" | "en_cours" | "prochaine" | "fait"
          photos: [],         // [{data: base64, name: "..."}]
          planAnnotations: null
        }
      ]
    }
  ]
}
```

---

### 5. API serverless sécurisées

Les fonctions dans `/api/` s'exécutent côté serveur sur Vercel (pas dans le navigateur).

| Endpoint | Rôle |
|----------|------|
| `GET /api/config` | Retourne l'URL et la clé publique Supabase (depuis les variables d'environnement) |
| `POST /api/ai-proxy` | Proxy vers l'API Claude — vérifie le token Supabase, limite les modèles et les tokens |

**Sécurité de `/api/ai-proxy`** :
- Vérifie le `Bearer token` Supabase sur chaque requête (seuls les utilisateurs connectés peuvent appeler l'IA)
- Liste blanche des modèles autorisés
- Plafond de 2 000 tokens par requête
- La clé Anthropic ne quitte jamais le serveur

---

### 6. Annotations de plans

`Annotator.jsx` est un outil de dessin vectoriel sur canvas HTML :
- **Stylo** : tracé libre avec couleur et épaisseur
- **Gomme** : effacement via `globalCompositeOperation: destination-out`
- **Texte** : ajout de labels positionnés
- **Symboles** : 9 symboles techniques prédéfinis (fissures, humidité, danger, NC, corrosion…)
- **Annuler** : supprime le dernier tracé
- Export PNG via `canvas.toDataURL()`

Les annotations sont sauvegardées sous forme de chemins vectoriels (`paths[]`) et d'une image exportée (`exported`).

---

## Variables d'environnement (Vercel)

À configurer dans le dashboard Vercel → Settings → Environment Variables :

```
SUPABASE_URL          URL de votre projet Supabase
SUPABASE_ANON_KEY     Clé publique Supabase (anon/public)
ANTHROPIC_API_KEY     Clé API Anthropic pour Claude
```

---

## Tables Supabase

| Table | Contenu |
|-------|---------|
| `profiles` | Profils utilisateurs (`is_approved`, `role`, `email`) |
| `app_state_store` | État JSON des projets (`id = 'default'`, `payload`) |
| `app_blob_store` | Blobs binaires images/PDF (`id`, `value`) |

> Les politiques RLS (Row Level Security) Supabase doivent être configurées pour restreindre l'accès aux données de chaque utilisateur.

---

## Développement local

```bash
# 1. Installer les dépendances
npm install

# 2. Créer un fichier .env.local avec les variables d'environnement
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_ANON_KEY=eyJ...
ANTHROPIC_API_KEY=sk-ant-...

# 3. Lancer le serveur de développement
npm run dev

# 4. Builder pour la production
npm run build
```

Le déploiement est automatique : chaque push sur `main` déclenche un build et un déploiement sur Vercel.
