# Structure du code — AI Chantier

> Document de référence pour comprendre l'organisation et le fonctionnement du code source.

---

## Arborescence complète

```
AI-Chantier-CD/
│
├── public/                          # Assets statiques servis tels quels par Vite
│   ├── logo_Ai_rouge_HD.png         # Logo principal (header + login)
│   ├── logo_Ai_noir_HD.png
│   ├── sigle_A_rouge_HD.png
│   ├── sigle_A_noir_HD.png
│   └── A_square.png
│
├── api/                             # Fonctions serverless Vercel (exécutées côté serveur)
│   ├── config.js                    # GET  /api/config      → URL + clé publique Supabase
│   ├── ai.js                        # POST /api/ai-proxy    → Proxy sécurisé vers Claude
│   └── state.js                     # (legacy) Route REST remplacée par le SDK Supabase
│
├── src/
│   ├── main.jsx                     # Point d'entrée : monte <App /> dans #root
│   ├── App.jsx                      # Racine React : ErrorBoundary → AuthGate
│   ├── styles.css                   # CSS global + classes responsives
│   ├── supabase.js                  # Client Supabase singleton
│   │
│   ├── hooks/
│   │   ├── useAuth.js               # État d'authentification (machine à états)
│   │   └── useProjets.js            # État global des projets + sauvegarde auto
│   │
│   ├── lib/
│   │   ├── constants.js             # Design tokens (couleurs, urgences, suivis)
│   │   ├── aiProxy.js               # Appel /api/ai-proxy avec token Bearer
│   │   ├── pdfUtils.js              # Chargement PDF.js + rendu de pages PDF en image
│   │   └── storage.js               # Persistence : Supabase → localStorage → mémoire
│   │
│   └── components/
│       ├── app/
│       │   ├── ChantierAI.jsx       # Shell principal : header global, routing, sync
│       │   └── VueProjet.jsx        # Vue détail projet : zones, observations, récap
│       │
│       ├── auth/
│       │   ├── AuthGate.jsx         # Aiguilleur selon état auth
│       │   ├── LoginScreen.jsx      # Connexion : email/mdp, Google, lien magique
│       │   ├── WaitingScreen.jsx    # Attente d'approbation admin
│       │   └── AdminPanel.jsx       # Gestion utilisateurs (approbation, rôles)
│       │
│       ├── dashboard/
│       │   ├── Dashboard.jsx        # Liste projets + stats (grille responsive)
│       │   ├── ProjectCard.jsx      # Carte projet avec menu actions
│       │   ├── NewProjet.jsx        # Modal création projet
│       │   └── PhotoModal.jsx       # Modal changement photo projet
│       │
│       ├── vue/
│       │   ├── SortList.jsx         # Liste observations draggable par zone
│       │   ├── ItemModal.jsx        # Formulaire observation (titre, urgence, photos, IA)
│       │   ├── IASug.jsx            # Suggestion Claude pour reformuler une observation
│       │   ├── TableauRecap.jsx     # Tableau récapitulatif éditable + génération IA
│       │   ├── Annotator.jsx        # Outil dessin canvas (stylo, gomme, texte, symboles)
│       │   ├── PlanLibraryModal.jsx # Bibliothèque de plans du projet (PDF/image)
│       │   ├── PlanLocModal.jsx     # Assignation plan à une zone + annotation
│       │   └── PdfPagePicker.jsx    # Sélecteur de page dans un PDF multi-pages
│       │
│       └── ui/
│           ├── Icons.jsx            # Icônes SVG inline + Badge urgence + BadgeSuivi
│           ├── EditTitle.jsx        # Titre éditable en place (double-clic)
│           └── ErrorBoundary.jsx    # Filet de sécurité pour les erreurs React
│
├── index.html                       # Entrée HTML (SPA)
├── index.legacy.html                # Archive de l'ancien prototype monolithique
├── vite.config.js                   # Config Vite + plugin React
├── vercel.json                      # Config déploiement Vercel
├── package.json                     # Dépendances npm
├── README.md                        # Documentation infrastructure et démarrage
└── STRUCTURE.md                     # Ce fichier
```

---

## Hiérarchie des composants

```
App
└── ErrorBoundary                    # Catch les erreurs React — affiche un écran de secours
    └── AuthGate                     # Lit useAuth() et affiche le bon écran
        │
        ├── (loading)   → Spinner
        ├── (loggedout) → LoginScreen
        ├── (waiting)   → WaitingScreen
        └── (approved)  → ChantierAI
                            │
                            ├── Dashboard          (ouvert === null)
                            │   ├── ProjectCard[]
                            │   └── PhotoModal
                            │
                            ├── VueProjet          (ouvert !== null)
                            │   ├── SortList[]
                            │   │   └── (item click) → ItemModal
                            │   │                       ├── IASug
                            │   │                       └── (annoter) → Annotator
                            │   ├── PlanLocModal
                            │   │   ├── PdfPagePicker
                            │   │   └── Annotator
                            │   ├── PlanLibraryModal
                            │   │   └── PdfPagePicker
                            │   └── TableauRecap
                            │
                            ├── NewProjet          (modal)
                            └── AdminPanel         (modal)
```

---

## Flux d'authentification

```
Chargement
    │
    ▼
useAuth()
    │── getSession()  ──────────────────────────────────┐
    │                                                    │
    ▼                                                    ▼
session ?                                          profiles table
    │                                              (is_approved, role)
    ├── Non  → état : 'loggedout'  → LoginScreen
    │
    └── Oui  → checkProfile()
                    │
                    ├── is_approved = true  → état : 'approved'  → ChantierAI
                    └── is_approved = false → état : 'waiting'   → WaitingScreen

Événements Supabase (onAuthStateChange) → relancent handleSession() en temps réel
```

---

## Flux de données — Projets

```
useProjets()
    │
    ├── Au chargement
    │     storage.loadData()
    │           ├── 1. Supabase (app_state_store + app_blob_store)  ← prioritaire
    │           ├── 2. localStorage                                  ← fallback
    │           └── 3. Mémoire (_mem)                               ← dernier recours
    │
    ├── À chaque modification
    │     debounce 2s → storage.saveData()
    │           ├── 1. localStorage                                  ← immédiat
    │           └── 2. Supabase (asynchrone)
    │
    └── Avant fermeture de l'onglet
          beforeunload → flush immédiat (contourne le debounce)
```

---

## Flux de navigation (sans routeur)

```
ChantierAI
    │
    ├── ouvert === null
    │     └── Dashboard
    │             └── ProjectCard (click) → setOuvert(projet)
    │
    └── ouvert !== null
          └── VueProjet
                  └── bouton retour → setOuvert(null)

Note : VueProjet reçoit toujours projets.find(p => p.id === ouvert.id)
       pour avoir la version fraîche depuis le store, pas l'objet stale.
```

---

## Gestion des modals dans VueProjet

Toute la logique modale est centralisée dans un seul état `modal` :

```javascript
// Valeurs possibles de modal :
null
{ t: 'item',    locId, item, savedForm? }   // ItemModal
{ t: 'plan',    locId }                     // PlanLocModal
{ t: 'planLib' }                            // PlanLibraryModal
{ t: 'annotate', locId, form }              // Annotator plein écran
```

**Flux annotation depuis ItemModal :**
```
ItemModal (onOpenAnnot(form))
    → modal = { t:'annotate', locId, form }
    → Annotator s'affiche en plein écran
    → onSave(paths, exported)
    → modal = { t:'item', ..., savedForm: { ...form, planAnnotations } }
    → ItemModal se remonte avec key différente (force réinitialisation)
```

---

## Sécurité des API serverless

```
Frontend
    │
    ├── /api/config  (GET, public)
    │       └── Retourne SUPABASE_URL + SUPABASE_ANON_KEY
    │           (clé publique — conçue pour être exposée)
    │
    └── /api/ai-proxy  (POST, authentifié)
            │
            ├── 1. Vérifie Authorization: Bearer <token>
            ├── 2. Valide le token via Supabase /auth/v1/user
            ├── 3. Contrôle le modèle (liste blanche)
            ├── 4. Plafonne à 2000 tokens max
            └── 5. Appelle api.anthropic.com avec ANTHROPIC_API_KEY
                   (la clé ne quitte jamais le serveur)
```

---

## Structure d'un projet (objet JSON)

```javascript
{
  id: "uuid-v4",
  nom: "Résidence Les Acacias",
  adresse: "12 rue des Acacias, Lyon",
  maitreOuvrage: "Ville de Lyon",
  photo: null,                          // base64 | null
  statut: "en_cours",                   // "en_cours" | "archive"
  planLibrary: [                        // Plans importés (PDF ou image)
    {
      id: "uuid",
      nom: "Plan RDC",
      bg: "data:image/...",             // image rendue (base64)
      data: "data:application/pdf;..."  // PDF source (base64) | null
    }
  ],
  tableauRecap: [                       // Lignes du tableau récapitulatif
    {
      id: "uuid",
      urgence: "haute",
      locNom: "RDC",
      desordre: "Fissures en façade",
      travaux: "Reprise enduit",
      suivi: "a_faire"
    }
  ],
  localisations: [                      // Zones de visite
    {
      id: "uuid",
      nom: "Rez-de-chaussée",
      planBg: null,                     // Image du plan de cette zone
      planData: null,                   // PDF source de cette zone
      planAnnotations: null,            // Annotations globales de zone
      items: [                          // Observations de cette zone
        {
          id: "uuid",
          titre: "Fissures en façade",
          commentaire: "Fissures horizontales sur 3m linéaires",
          urgence: "haute",             // "haute" | "moyenne" | "basse"
          suivi: "a_faire",             // "rien"|"a_faire"|"en_cours"|"prochaine"|"fait"
          photos: [
            { data: "data:image/...", name: "photo.jpg" }
          ],
          planAnnotations: {            // Localisation sur le plan
            paths: [...],              // Tracés vectoriels
            exported: "data:image/..." // Image exportée avec annotations
          }
        }
      ]
    }
  ]
}
```

---

## Système de stockage (storage.js)

```
Écriture                              Lecture
─────────                             ───────
saveData(projets)                     loadData()
    │                                     │
    ├─ Extrait les blobs                  ├─ loadRemote()  (Supabase)
    │   (images, PDFs)                    │     ├─ app_state_store → payload JSON
    │                                     │     └─ app_blob_store  → blobs par ID
    ├─ Remplace blobs                     │
    │   par '__img__' / '__pdf__'         ├─ Si Supabase KO → localStorage
    │                                     │
    ├─ stor.set(SK, JSON slim)            └─ Reconstruit les blobs
    │   localStorage immédiat                 (replace '__img__' → base64)
    │
    └─ saveRemote()  (async)
          ├─ app_state_store (upsert)
          └─ app_blob_store  (upsert)
```

**Clés de blobs :**
| Type | Clé |
|------|-----|
| Plan de bibliothèque (image) | `plb_{projectId}_{planId}` |
| Plan de bibliothèque (PDF)   | `pld_{projectId}_{planId}` |
| Plan de zone (image)         | `pb_{projectId}_{locId}`  |
| Plan de zone (PDF)           | `pd_{projectId}_{locId}`  |

---

## Responsive — points de bascule

```
< 640px   → Mobile    : bottom-sheets, 1 colonne projets, 2 stats
≥ 640px   → Desktop   : modals centrées (max 540px), 4 stats
≥ 1024px  → Large     : 3 colonnes projets
```

**Classes CSS utilisées :**
| Classe | Rôle |
|--------|------|
| `.proj-grid` | Grille responsive pour les cartes projets |
| `.stats-grid` | Grille responsive pour les statistiques |
| `.modal-overlay` | Overlay modal (flex-end mobile → centré desktop) |
| `.modal-overlay-dark` | Idem, fond plus sombre (AdminPanel) |
| `.modal-sheet` | Feuille blanche scrollable |
| `.modal-sheet-flex` | Feuille blanche avec flex-column (modals à sections) |

---

## Tables Supabase

| Table | Colonnes | Rôle |
|-------|----------|------|
| `profiles` | `id`, `email`, `full_name`, `role`, `is_approved`, `created_at` | Gestion des accès utilisateurs |
| `app_state_store` | `id` (`'default'`), `payload` (JSON), `updated_at` | État JSON des projets |
| `app_blob_store` | `id` (string), `value` (base64), `updated_at` | Images et PDFs |

---

## Variables d'environnement

| Variable | Où | Rôle |
|----------|----|------|
| `SUPABASE_URL` | Vercel | URL du projet Supabase |
| `SUPABASE_ANON_KEY` | Vercel | Clé publique Supabase |
| `ANTHROPIC_API_KEY` | Vercel | Clé API Claude (jamais exposée au client) |

---

## Conventions de code

| Convention | Valeur |
|------------|--------|
| IDs | `crypto.randomUUID()` (UUID v4 natif) |
| Styles | Inline objects React (pas de CSS framework) |
| Couleurs | Centralisées dans `lib/constants.js` → `DA.*` |
| Icônes | SVG inline dans `ui/Icons.jsx` → `<Ic n="..." s={18}/>` |
| Modals | État `modal` centralisé dans le composant parent |
| Sauvegarde | Debounce 2s + flush `beforeunload` |
| Auth API | Bearer token automatique via `aiProxy.js` |
