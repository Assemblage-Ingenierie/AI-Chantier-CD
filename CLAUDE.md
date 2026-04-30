# AI Chantier CD — Instructions pour Claude Code

## Workflow Git obligatoire

**Après chaque push sur une branche feature, merger immédiatement sur `main` :**

```bash
git checkout main
git pull origin main
git merge <feature-branch> --no-edit
git push origin main
git checkout <feature-branch>   # retourner sur la branche de travail
```

Ne jamais laisser des changements uniquement sur la branche feature — l'app est déployée depuis `main` via Vercel.

## Stack technique

- React + Vite, déployé sur Vercel
- Supabase pour la base de données et l'auth
- Styles inline (pas de CSS modules), variables dans `src/lib/constants.js`
- Icônes via `<Ic n="..." s={...}/>` dans `src/components/ui/Icons.jsx`
- Proxy IA Vercel : `api/ai-proxy.js` (modèle actuel : `gemma-3-12b-it`)
- Variables d'env Vercel requises : `GEMINI_API_KEY`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`

## Règles de développement

- Ne jamais modifier le schéma Supabase sans migration dans `supabase/migrations/`
- Le cache localStorage utilise la clé `chantierai_v12`
- `useProjets.js` gère tout l'état des projets — ne pas dupliquer cette logique
- Toujours tester que `remoteLoaded` est bien géré si on touche au chargement

## Supabase Storage

- Bucket photos : **`photos`** (privé) — toujours utiliser `createSignedUrl`, jamais `getPublicUrl`
- Bucket logos : **`Branding`** (B majuscule, public) — ne jamais créer un nouveau bucket
- Fichiers logos dans `Branding` : `logo/logo_Ai_rouge.svg`, `logo/logo_Ai_rouge.png`, `logo/sigle_Ai_rouge.svg`, `logo/sigle_Ai_rouge.png`
- Dossiers photos structurés : `{slug_nom}_{8chars_id}/cover/` et `{slug_nom}_{8chars_id}/{item_id}/`
- La logique de nommage est dans `slugify()` + `saveRemote()` dans `src/lib/storage.js`

## RLS Supabase

- `aichantier_profiles` : policies SELECT/UPDATE utilisent `is_admin()` (fonction SECURITY DEFINER) — ne jamais faire de subquery directe sur cette table dans une policy (récursion infinie)
- Bucket `photos` : policies storage dans `storage.objects`, vérifier qu'elles couvrent SELECT/INSERT/UPDATE/DELETE
- Toute nouvelle table doit avoir RLS activé + policies explicites
