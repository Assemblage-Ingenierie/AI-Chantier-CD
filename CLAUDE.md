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

## Règle absolue — NE PAS CASSER CE QUI MARCHE

**Toute correction, même minime (texte, style, prompt), doit être chirurgicale : toucher uniquement les lignes concernées, sans refactorer ni "améliorer" le reste.**

Un bug de texte ne justifie jamais de réécrire une fonction. Une optimisation de prompt ne justifie jamais de changer la logique d'appel. Si la tentation est de "nettoyer" du code qui marche → ne pas le faire.

Avant chaque modification :
1. Lire le fichier entier pour comprendre ce qui existe
2. Identifier les **lignes exactes** à changer — et uniquement celles-là
3. Si une modification touche à un fichier avec des fonctionnalités fragiles (voir liste ci-dessous), **signaler le risque à l'utilisateur avant d'agir**
4. En cas de conflit Git, toujours prendre la version la plus complète (jamais retirer des features)

Fonctionnalités à ne JAMAIS toucher sans ordre explicite :
- **Dictée vocale** (`doRecognize`, `startDictaphone`, `stopDictaphone` dans `ItemModal.jsx`) — logique fragile sur iOS, ne pas modifier
- **Correction IA / `fixSpelling`** — ne pas modifier le flux sauf bug signalé
- **`bumpSync` / `editorSyncKey`** — ne modifier qu'après avoir compris l'impact sur l'éditeur riche ET la dictée
- **Hydratation des plans** (`hydratePlans`, `hydratePlanLibrary`, `hydratePlansRemote`) — la chaîne d'appel est précise, ne pas réordonner
- **`mergeWithLocal`** — critique pour la cohérence local/remote, toute modification doit être explicitement demandée
- **Annotator / PlanLocModal / NiveauxModal** — fonctionnalités complètes, ne pas retirer de logique existante
- **Gestion `planId` / `planBg` / `planData`** — les trois champs forment un triplet, toujours les traiter ensemble

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
