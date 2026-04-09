# ChantierAI — Guide de développement Assemblage Ingénierie

## Vue d'ensemble de l'application

**ChantierAI** est une PWA (Progressive Web App) de suivi de chantier pour Assemblage Ingénierie.

| Paramètre | Valeur |
|---|---|
| Stack | Next.js 14 + Tailwind CSS + shadcn/ui |
| Base de données | Supabase (PostgreSQL + Auth + Storage) |
| IA | Claude API (`claude-sonnet-4-20250514`) |
| Hébergement | Vercel |
| Repo | GitHub (`Assemblage-Ingenierie/AI-Chantier-CD`) |
| Mode offline | **🚧 PRÉVU — pas encore implémenté** |
| Génération PDF | Puppeteer / @sparticuz/chromium (serverless) |
| Tests E2E | Playwright (Chrome, iPhone 15, Pixel 7, iPad Pro) |

> **État actuel** : prototype React compilé inline dans `index.html`. La migration vers Next.js 14 est la prochaine étape structurante.

**Fonctionnalités principales :**
- Projets + visites de chantier
- Remarques avec 4 niveaux de criticité
- Annotation photo sur plan (Fabric.js)
- Génération rapport IA (3 tons : Technique / Vulgarisé / Juridique)
- Export PDF premium + Excel
- Espace client JWT (lecture seule)
- Push notifications (VAPID)
- Signature électronique intervenants
- Mode hors-ligne complet avec sync différée

---

## 1. Prérequis — avant de toucher au code

### 1.1 Toujours lire avant d'écrire

Avant toute modification, **lire les fichiers concernés** dans leur intégralité. Ne jamais supposer le contenu d'un fichier.

### 1.2 Comprendre l'impact de la modification

Poser ces questions avant de coder :
1. Ce changement affecte-t-il la base de données Supabase ? → Prévoir une migration SQL
2. Ce changement affecte-t-il le mode offline ? → Tester le Service Worker
3. Ce changement affecte-t-il l'auth ? → Vérifier les RLS Supabase
4. Ce changement affecte-t-il le PDF / rapport ? → Tester Puppeteer en local
5. Ce changement affecte-t-il des composants partagés ? → Vérifier tous les usages

### 1.3 Variables d'environnement

**Ne jamais hardcoder** de clé API, URL, ou secret dans le code. Tout passe par `.env.local` (local) et les variables Vercel (production).

Variables requises :
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `ANTHROPIC_API_KEY`
- `NEXT_PUBLIC_VAPID_PUBLIC_KEY`
- `VAPID_PRIVATE_KEY`

---

## 2. Workflow Git — règle d'or

> **Règle absolue : on ne pousse JAMAIS directement sur `main`.**

### 2.1 Procédure standard pour chaque modification

```bash
# 1. Partir d'un main à jour
git checkout main
git pull origin main

# 2. Créer une branche pour la modif
git checkout -b feat/nom-court-de-la-feature

# 3. Faire les modifications

# 4. Tester en local

# 5. Commit avec un message clair (Conventional Commits)
git add .
git commit -m "feat: description courte de ce qui a changé"

# 6. Pousser la branche
git push origin feat/nom-court-de-la-feature

# 7. Créer une Pull Request sur GitHub — jamais merger soi-même sans review
```

### 2.2 Convention de nommage des branches

| Préfixe | Usage |
|---|---|
| `feat/` | Nouvelle fonctionnalité |
| `fix/` | Correction de bug |
| `refactor/` | Réécriture sans changement de comportement |
| `chore/` | MAJ dépendances, config, docs |
| `hotfix/` | Correction urgente en prod |

### 2.3 Messages de commit (Conventional Commits)

Format : `type(scope): description`

```
feat(remarques): ajout criticité niveau 5 "danger immédiat"
fix(offline): correction écrasement données locales lors du pull
fix(pdf): correction encoding caractères spéciaux dans Puppeteer
chore(deps): mise à jour Next.js 14.2.3 → 14.2.5
```

---

## 3. Architecture des fichiers — ne pas casser la structure

```
AI-Chantier-CD/
├── app/                          # Pages Next.js App Router
│   ├── api/                      # Routes API serverless
│   │   ├── generate-report/      # IA → génération rapport JSON
│   │   ├── generate-pdf/         # Puppeteer → PDF premium
│   │   ├── export-excel/         # ExcelJS → export .xlsx
│   │   ├── push/                 # Notifications push VAPID
│   │   └── [token]/              # Espace client JWT
│   ├── projets/                  # Pages projets + visites
│   ├── login/                    # Auth Supabase
│   └── client/[token]/           # Espace client lecture seule
├── components/
│   ├── layout/                   # Sidebar, BottomNav, OfflineBanner
│   ├── ui/                       # CriticalityBadge + shadcn/ui
│   ├── projects/                 # ProjectCard, liste projets
│   ├── visites/                  # Formulaire visite, liste remarques
│   ├── photo/                    # Annotation plan Fabric.js
│   ├── rapport/                  # UI génération rapport 3 étapes
│   └── signature/                # SignatureModal
├── lib/
│   ├── supabase/                 # Client Supabase + helpers
│   ├── offline/                  # useOfflineSync hook
│   └── push/                    # usePushNotifications hook
├── public/
│   ├── manifest.json             # PWA manifest
│   └── sw.js                     # Service Worker
├── tests/e2e/                    # Playwright tests
├── middleware.ts                 # Auth guard Next.js
└── .env.local                    # Variables locales (JAMAIS committé)
```

### Règles de structure
- **Ne pas créer de nouveaux dossiers** sans raison claire
- **Un composant = un fichier** — pas de fichiers de 1000 lignes
- **Les appels Supabase** se font UNIQUEMENT dans `lib/supabase/` ou dans les routes API
- **Les appels Claude API** se font UNIQUEMENT dans `app/api/generate-report/`

---

## 4. Règles de code — conventions à respecter

### 4.1 TypeScript — typage obligatoire

```typescript
// ❌ INTERDIT
const handleClick = (data: any) => { ... }

// ✅ CORRECT
interface RemarqueData {
  id: string
  criticite: 1 | 2 | 3 | 4
  description: string
  photos: string[]
}
const handleClick = (data: RemarqueData) => { ... }
```

### 4.2 Supabase — toujours gérer les erreurs

```typescript
// ✅ CORRECT
const { data, error } = await supabase.from('remarques').select('*')
if (error) {
  console.error('Erreur chargement remarques:', error)
  return []
}
return data.map(...)
```

### 4.3 Gestion du mode offline

> **🚧 FONCTIONNALITÉ PRÉVUE — pas encore implémentée.**
> Ne pas développer cette partie sans concertation avec Thomas.

### 4.4 Charte graphique Assemblage — ne pas dévier

```typescript
const COLORS = {
  red: '#E30513',        // Rouge Assemblage
  redDark: '#B8040F',    // Hover/active
  bg: '#FFFFFF',
  text: '#2F313E',
}

const CRITICITE = {
  1: { label: 'Info',     color: '#3B82F6' }, // bleu
  2: { label: 'Mineure',  color: '#F59E0B' }, // ambre
  3: { label: 'Majeure',  color: '#F97316' }, // orange
  4: { label: 'Critique', color: '#EF4444' }, // rouge
}
```

### 4.5 Taille des boutons terrain — obligation mobile

Minimum **56px de hauteur** pour usage avec gants ou sur mobile :

```typescript
<button className="h-14 min-h-[56px] px-4 ...">Action</button>
```

---

## 5. Tester avant de déployer

### 5.1 Lancer en local

```bash
npm install
npm run dev   # localhost:3000
```

### 5.2 Checklist avant chaque PR

- [ ] L'app se lance sans erreur console
- [ ] Fonctionne sur desktop (Chrome)
- [ ] Fonctionne sur mobile (Chrome DevTools → iPhone 12)
- [ ] Fonctionne en mode offline (DevTools → Network → Offline)
- [ ] Aucune régression sur liste remarques et génération rapport
- [ ] `npm run build` sans erreur TypeScript

### 5.3 Lancer les tests E2E Playwright

```bash
npx playwright test
npx playwright test --headed
npx playwright test --device="iPhone 15"
```

---

## 6. Déployer sur Vercel

> **Le déploiement est automatique** : merge sur `main` → Vercel redéploie.

```
branche feature → PR GitHub → review → merge main → Vercel déploie automatiquement
```

### Rollback d'urgence

Vercel dashboard → Deployments → cliquer sur le dernier déploiement stable → "Redeploy"

---

## 7. Modifications de la base de données Supabase

> **Ne jamais modifier la DB Supabase en production directement via l'interface.**

```bash
supabase migration new nom_de_la_migration
# → crée supabase/migrations/YYYYMMDD_nom.sql
npx supabase db push
```

### Règles RLS — ne jamais désactiver

```sql
-- ❌ INTERDIT
ALTER TABLE remarques DISABLE ROW LEVEL SECURITY;

-- ✅ Ajouter une policy si nécessaire
CREATE POLICY "users can see own project remarques"
  ON remarques FOR SELECT
  USING (project_id IN (
    SELECT id FROM projects WHERE user_id = auth.uid()
  ));
```

---

## 8. Modifier le Service Worker (offline)

Toujours incrémenter le numéro de version du cache :

```javascript
const CACHE_NAME = 'chantier-ai-v12' // ← incrémenter à chaque modif
```

---

## 9. Ce qu'on ne fait JAMAIS

| Action interdite | Raison | Alternative |
|---|---|---|
| Push direct sur `main` | Casse la prod sans filet | Toujours passer par une PR |
| Commit de `.env.local` | Expose les clés API | `.env.local` est dans `.gitignore` |
| `any` en TypeScript | Masque les bugs | Typer correctement |
| Désactiver RLS Supabase | Expose les données clients | Créer une policy adaptée |
| Modifier `sw.js` sans incrémenter le cache | Clients bloqués en cache périmé | Toujours incrémenter |
| Hardcoder une clé API dans le code | Sécurité compromise | Variables d'environnement |
| `npm install` d'un package inconnu | Faille supply chain | Vérifier sur npmjs.com d'abord |
| Supprimer des colonnes Supabase sans migration | Perte de données | Migration SQL versionnée |

---

## 10. En cas de bug en production

```
1. L'app est totalement inutilisable ? → Rollback immédiat via Vercel
2. Sinon → corriger sur branche fix/ et déployer normalement
3. Reproduire le bug en local
4. Corriger → tester → PR → merge → déploiement auto
5. Logger l'incident dans une issue GitHub
```
