# AI Chantier CD — Instructions pour Claude Code

---

## 🟡 RÈGLE N°1 — PUSH ET MERGE AUTOMATIQUE AUTORISÉS

**L'utilisateur a donné accord général pour pusher et merger sur `main` sans demander confirmation à chaque fois, tant que les changements sont sûrs et ne cassent rien.**

Workflow :
1. Faire les changements en local
2. Committer sur la branche feature
3. Push sur la branche feature
4. Merger immédiatement sur `main` si le build passe et qu'aucune zone critique n'est touchée
5. Pour les changements à risque élevé (persistance, auth, schéma Supabase) : présenter un résumé et attendre confirmation

Zones qui nécessitent encore une confirmation explicite :
- Modifications de `mergeWithLocal`, `saveRemote`, `loadData` (persistance données)
- Changements de schéma Supabase (migrations)
- Toute modification qui pourrait provoquer une perte de données utilisateur

---

## 🔴 RÈGLE N°2 — ZÉRO PERTE DE DONNÉES, ZÉRO RÉGRESSION

L'application est utilisée en production pour des rapports de chantier professionnels.
**Une donnée perdue ou une fonctionnalité cassée a un impact réel sur le travail des utilisateurs.**

Interdictions absolues :
- Ne jamais modifier `mergeWithLocal`, `saveRemote`, `saveLocalCache` ou `loadData` sans analyse complète de l'impact sur la persistance
- Ne jamais changer la clé localStorage (`chantierai_v12`) — tout changement de clé efface le cache local de tous les utilisateurs
- Ne jamais supprimer une fonctionnalité existante sans demande explicite
- Ne jamais rendre optionnel ce qui était obligatoire (ex : champs de sauvegarde, étapes de sync)
- Ne jamais introduire un changement qui ferait perdre des données en cas de rechargement de page

---

## 🔴 RÈGLE N°3 — ANALYSE AVANT D'AGIR

**Avant chaque modification, même minime :**

1. Lire le fichier entier concerné pour comprendre le contexte complet
2. Identifier les **lignes exactes** à changer — et uniquement celles-là
3. Vérifier si d'autres fichiers dépendent de la fonction/composant modifié (`grep` les usages)
4. Si le fichier touche à une zone fragile (liste ci-dessous) → **signaler le risque à l'utilisateur avant d'agir**
5. En cas de doute sur l'impact → poser la question plutôt que d'improviser

Un bug de texte ne justifie jamais de réécrire une fonction.
Une optimisation de prompt ne justifie jamais de changer la logique d'appel.
Si la tentation est de "nettoyer" du code qui marche → **ne pas le faire**.

---

## Workflow Git

**Branche de travail** : toujours développer sur une branche feature dédiée.
**Push** : uniquement après accord explicite de l'utilisateur (voir Règle N°1).
**Merge sur main** : immédiatement après le push, car Vercel déploie depuis `main`.

```bash
# Après accord de l'utilisateur :
git push -u origin <feature-branch>
git checkout main
git pull origin main
git merge <feature-branch> --no-edit
git push origin main
git checkout <feature-branch>
```

Ne jamais laisser des changements uniquement sur la branche feature.

---

## Stack technique

- React + Vite, déployé sur Vercel depuis la branche `main`
- Supabase pour la base de données et l'auth
- Styles inline (pas de CSS modules), variables dans `src/lib/constants.js`
- Icônes via `<Ic n="..." s={...}/>` dans `src/components/ui/Icons.jsx`
- Proxy IA Vercel : `api/ai-proxy.js` (modèle actuel : `gemma-3-12b-it`)
- Variables d'env Vercel requises : `GEMINI_API_KEY`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`

---

## Architecture de sauvegarde — NE PAS TOUCHER SANS ANALYSE COMPLÈTE

La sauvegarde est le cœur de l'application. Toute régression ici = perte de données utilisateur.

### Flux de données
```
État React (projets[])
  └─► localStorage (clé chantierai_v12)   ← cache immédiat
  └─► Supabase (saveRemote)               ← sync différée, auto toutes ~5s si modifié
```

### Fichiers critiques
| Fichier | Rôle | Risque si modifié |
|---|---|---|
| `src/hooks/useProjets.js` | Tout l'état des projets | Très élevé — ne jamais dupliquer cette logique |
| `src/lib/storage.js` | Lecture/écriture Supabase + localStorage | Très élevé — impact direct sur la persistance |
| `src/lib/storage.js > mergeWithLocal` | Fusion local/remote au chargement | Critique — peut provoquer perte ou doublon de projets |
| `src/lib/storage.js > saveRemote` | Sync vers Supabase | Critique — contient la garde anti-mass-delete |
| `src/lib/storage.js > deleteRemoteProjet` | Suppression immédiate depuis Supabase | Sensible — contourne intentionnellement la garde |

### Règles spécifiques sauvegarde
- `_lastRemoteIds` (module-level dans storage.js) : toujours le mettre à jour après toute opération de suppression distante
- La garde anti-mass-delete (>50%) dans `saveRemote` est intentionnelle — ne pas la supprimer, elle protège contre les corruptions de cache
- `deleteRemoteProjet` a été ajouté pour contourner cette garde **uniquement** pour les suppressions explicites utilisateur
- `remoteLoaded` doit toujours être géré correctement si on touche au chargement initial

---

## Fonctionnalités à ne JAMAIS toucher sans ordre explicite

- **Dictée vocale** (`doRecognize`, `startDictaphone`, `stopDictaphone` dans `ItemModal.jsx`) — logique fragile sur iOS
- **Correction IA / `fixSpelling`** — ne pas modifier le flux sauf bug signalé
- **`bumpSync` / `editorSyncKey`** — ne modifier qu'après avoir compris l'impact sur l'éditeur riche ET la dictée
- **Hydratation des plans** (`hydratePlans`, `hydratePlanLibrary`, `hydratePlansRemote`) — chaîne d'appel précise, ne pas réordonner
- **`mergeWithLocal`** — critique pour la cohérence local/remote
- **Annotator / PlanLocModal / NiveauxModal** — fonctionnalités complètes, ne pas retirer de logique existante
- **Gestion `planId` / `planBg` / `planData`** — les trois champs forment un triplet, toujours les traiter ensemble
- **`drawAnnotationPaths`** — exportée et utilisée dans `RapportPreview.jsx`, tout nouveau type d'annotation doit aussi y être ajouté

---

## Règles de développement

- Ne jamais modifier le schéma Supabase sans migration dans `supabase/migrations/`
- Ne jamais changer la clé du cache localStorage (`chantierai_v12`)
- `useProjets.js` gère tout l'état des projets — ne pas dupliquer cette logique ailleurs
- Toujours vérifier que `remoteLoaded` est correctement géré si on touche au chargement
- En cas de conflit Git, toujours prendre la version la plus complète (ne jamais retirer des features)
- Préférer `Edit` (modification chirurgicale) à `Write` (réécriture complète) sur les fichiers existants

---

## Supabase Storage

- Bucket photos : **`photos`** (privé) — toujours utiliser `createSignedUrl`, jamais `getPublicUrl`
- Bucket logos : **`Branding`** (B majuscule, public) — ne jamais créer un nouveau bucket
- Fichiers logos dans `Branding` : `logo/logo_Ai_rouge.svg`, `logo/logo_Ai_rouge.png`, `logo/sigle_Ai_rouge.svg`, `logo/sigle_Ai_rouge.png`
- Dossiers photos structurés : `{slug_nom}_{8chars_id}/cover/` et `{slug_nom}_{8chars_id}/{item_id}/`
- La logique de nommage est dans `slugify()` + `saveRemote()` dans `src/lib/storage.js`

---

## RLS Supabase

- `aichantier_profiles` : policies SELECT/UPDATE utilisent `is_admin()` (fonction SECURITY DEFINER) — ne jamais faire de subquery directe sur cette table dans une policy (récursion infinie)
- Bucket `photos` : policies storage dans `storage.objects`, vérifier qu'elles couvrent SELECT/INSERT/UPDATE/DELETE
- Toute nouvelle table doit avoir RLS activé + policies explicites

---

## Incidents connus (historique)

| Date | Problème | Cause | Correction apportée |
|---|---|---|---|
| 2026-05-13 | Suppression massive accidentelle de projets | Corruption cache local → diff supprimait tout | Garde anti-mass-delete dans `saveRemote` (cap 50%) |
| 2026-05-21 | Projets supprimés réapparaissent sur autre appareil | Garde anti-mass-delete bloquait les suppressions légitimes >50% | `deleteRemoteProjet()` : suppression immédiate sur Supabase |
| 2026-05-21 | Plans très lents à charger | `hydratePlanLibrary` chargeait aussi les PDF bruts | Requête réduite à `id,bg` uniquement |
