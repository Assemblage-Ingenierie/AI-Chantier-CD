# AI Chantier CD — Instructions pour Claude Code

---

## 🟢 RÈGLE N°0 — APPELER L'UTILISATEUR PAR SON PRÉNOM

**L'utilisateur s'appelle Thomas.** Le saluer/l'appeler par son prénom (« Thomas ») **au début de chaque réponse qui ouvre une nouvelle mise à jour ou une nouvelle demande**. Cela sert aussi de point de repère pour vérifier la continuité du contexte au fil de la conversation.

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

## 🟠 RÈGLE N°4 — COMPATIBILITÉ ANDROID / iOS OBLIGATOIRE

**Chaque modification doit être évaluée pour ses effets sur Android ET iOS avant tout merge sur `main`.**

### Checklist à valider pour chaque changement touchant le mobile

Avant de merger, se poser systématiquement ces questions :

| Zone | Question |
|---|---|
| **Événements tactiles** | `onPointerDown/Up/Cancel` fonctionne-t-il sur iOS Safari et Chrome Android ? |
| **API navigateur** | L'API utilisée est-elle supportée sur Safari ≥ 16 et Chrome Android ≥ 110 ? |
| **Permissions** | La demande de permission (micro, caméra, fichiers) suit-elle le flux iOS (user gesture obligatoire) ? |
| **Fichiers / téléchargement** | La fonctionnalité de téléchargement utilise-t-elle une approche compatible iOS (pas de `download` attribut seul) ? |
| **CSS / layout** | Le rendu est-il vérifié sur un viewport mobile (375px, safe-area-inset) ? |
| **Dictée vocale** | `webkitSpeechRecognition` + `setPointerCapture` dans un try/catch ? |

### ⚠️ Signalement obligatoire

Si une modification crée un **comportement différent entre Android et iOS**, il faut :
1. **Le signaler explicitement** à l'utilisateur avant de merger
2. **Proposer une solution spécifique** (fallback, détection de plateforme, alternative UI)
3. **Ne pas laisser un comportement dégradé silencieux** sur l'une des plateformes

### Différences Android / iOS connues — à ne pas régresser

| Fonctionnalité | Android (Chrome) | iOS (Safari) | Solution en place |
|---|---|---|---|
| **Sauvegarde photos Drive** | Upload automatique en arrière-plan | Idem via retry + queue localStorage | `src/lib/driveUpload.js` |
| **Dictée vocale push-to-talk** | `SpeechRecognition` natif, fiable | `webkitSpeechRecognition`, s'arrête toutes les ~5-10s | Restart auto dans `onend` (`ItemModal.jsx`) |
| **`setPointerCapture`** | Fonctionne toujours | Peut lever une exception sur certaines versions | `try/catch` dans `onPointerDown` (`ItemModal.jsx`) |
| **Téléchargement de fichiers** | Attribut `download` fonctionnel | Ne déclenche pas de téléchargement → redirection ou partage natif (`navigator.share`) | À vérifier si on ajoute des exports |
| **Input `type="file"` + caméra** | Propose Galerie OU Caméra | Propose les deux, mais comportement WebKit spécifique | Non traité — à surveiller |
| **`localStorage`** | Disponible | Disponible sauf mode navigation privée | Guard `_hasLS` dans `supabase.js` et `useAuth.js` |
| **PWA / Install prompt** | `beforeinstallprompt` supporté | Pas de prompt natif — instruction manuelle "Ajouter à l'écran d'accueil" | Non implémenté |

### Détection de plateforme (si besoin dans le code)

```js
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
const isMobile = /Mobi|Android/i.test(navigator.userAgent) || isIOS;
```

> Ne pas surcharger le code de détections — préférer des API universelles ou des fallbacks CSS. La détection n'est à utiliser qu'en dernier recours.

---

## 🟣 RÈGLE N°5 — LÉGÈRETÉ & UX AVANT TOUT

**L'application doit rester la plus légère et la plus simple possible. N'importe qui, même sans notice, doit comprendre chaque fonctionnalité au premier coup d'œil.** Priorité absolue : *beau, épuré, ergonomique*. Un chantier se remplit vite, sur téléphone, souvent d'une main — l'app ne doit jamais ralentir ni faire réfléchir.

### Principes non négociables

1. **Pas de prolifération de boutons.** Avant d'ajouter un bouton/onglet/menu, chercher d'abord à :
   - le rendre inutile (bon défaut, comportement automatique),
   - le fusionner avec un contrôle existant,
   - le cacher tant qu'il n'est pas pertinent (révélation progressive).
   Si un bouton doit vraiment exister, il remplace ou se range à côté d'un existant — il ne s'empile pas.
2. **Zéro configuration obligatoire.** Toute nouvelle capacité est **optionnelle et invisible par défaut** : ne rien remplir = comportement d'avant, identique. On n'impose jamais une nouvelle étape à celui qui n'en a pas besoin.
3. **Révélation progressive.** Les options avancées (sous-parties, bâtiments, etc.) n'apparaissent que quand l'utilisateur commence à s'en servir. Pas de champs vides qui encombrent l'écran par défaut.
4. **Une action = un geste évident.** Pas de double sens, pas de menu à tiroirs pour une action courante. Le libellé dit ce qui va se passer.
5. **Beauté = contrainte, pas bonus.** Espacements cohérents, alignements propres, pas de surcharge visuelle. Sur un viewport 375px, l'écran ne doit jamais paraître « plein de trucs ».

### Réflexe avant tout ajout d'UI

Se poser, dans l'ordre : « Est-ce que ça peut être **automatique** ? Sinon **fusionnable** ? Sinon **caché jusqu'à utile** ? Sinon seulement, l'ajouter — et retirer ou ranger quelque chose en échange. » Si un ajout rend l'écran plus chargé sans gain clair pour un utilisateur lambda → **ne pas le faire, ou le proposer à Thomas avant**.

---



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
- Proxy IA Vercel : `api/ai-proxy.js` (Anthropic/Claude, avec fallback modèle ; auth Bearer Supabase + rate limiting 20 req/min/IP)
- Variables d'env Vercel requises : `ANTHROPIC_API_KEY`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `GOOGLE_SERVICE_ACCOUNT` (Drive)
- Tests : `npm test` (Vitest) ; lint : `npm run lint` (ESLint) ; CI dans `.github/workflows/ci.yml` (test + build bloquants)
- Monitoring : `src/lib/logger.js` → `api/log.js` (console + Vercel Runtime Logs) ; Vercel Analytics dans `App.jsx`

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
| `src/hooks/useProjets.js > mergeWithLocal` | Fusion local/remote au chargement (exportée, testée dans `mergeWithLocal.test.js`) | Critique — peut provoquer perte ou doublon de projets |
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
- **TDZ / ordre de déclaration** : dans le corps d'un composant, ne JAMAIS référencer directement (hors callback) une `const`/`useMemo` déclarée plus bas — crash runtime « Cannot access before initialization » que ni le build ni les tests n'attrapent. Après tout ajout de code dans un gros composant, vérifier avec : `npx eslint <fichier> --rule '{"no-use-before-define": ["error", {"functions": false, "variables": true}]}'` (les hits dans des callbacks/handlers sont OK, les hits au niveau du corps sont des bombes)
- **Drag & drop vs sélection de texte** (bug récurrent, signalé 3× par Thomas) : sélectionner du texte dans un input déclenche le DRAG NATIF de la sélection, qui remonte aux conteneurs. Tout conteneur réordonnable doit : (1) n'être `draggable` que quand sa poignée l'ARME (mousedown), (2) avoir un `onDragStart` gardé qui fait `e.preventDefault()` si non armé, (3) garder ses `onDragEnter/OnDragOver` par « un drag est réellement en cours » (state). Tout input DANS un tel conteneur : `draggable={false}` + `onDragStart={e => { e.preventDefault(); e.stopPropagation(); }}`

---

## 🔴 EXPORT PDF — POIDS TOUJOURS ENVOYABLE PAR EMAIL (exigence Thomas)

**Tout PDF exporté par l'app DOIT rester envoyable par email — cible MAX 5 Mo (exigence Thomas), tout en conservant une bonne qualité photo ET des plans NETS — SANS EXCEPTION.** Un rapport à 14 Mo (ou pire, 45 Mo) est inadmissible (rejeté par la plupart des messageries).

- ⚠️ Le chemin d'export RÉEL est `src/components/vue/RapportPreview.jsx > useImperativeHandle > print()` (impression navigateur du DOM de l'aperçu → « Enregistrer en PDF »). `generateRapport.js > exportPdf` (moteur jsPDF vectoriel) existe encore mais n'est PLUS branché. Toute garantie de poids/qualité doit vivre dans `print()`.
- **Budget de poids OBLIGATOIRE** (dans `print()`) : après encodage des images, on mesure le poids cumulé ; tant qu'il dépasse la cible (~4,6 Mo d'images pour rester < 5 Mo), on réduit d'ABORD les PHOTOS (paliers résolution/qualité `PHOTO_TIERS`), puis EN DERNIER RECOURS les PLANS (`PLAN_TIERS`). Ne JAMAIS retirer ce budget.
- **Plans NETS** : les images `data-role="plan"` (plans + annexes) sont encodées en HAUTE résolution (palier initial 3000px q0.85) pour rester nettes « comme le PDF » ; elles ne sont dégradées que si le budget l'exige, après les photos.
- Ne jamais embarquer une image en pleine résolution capteur sans la ré-encoder. Les plans par observation peuvent multiplier le nombre d'images embarquées → le budget doit rester le garde-fou.
- Si on ajoute un nouveau type d'export PDF, il doit passer par le même budget.
- Log de contrôle : `[PDF] Images ~X Mo …` à chaque export (console). Le poids FINAL dépend ensuite du moteur d'impression du navigateur (qui peut encore ré-échantillonner) — calibrer la cible d'après le retour terrain.

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
| 2026-07-07 | App plantée en PROD à l'ouverture du panneau Plans (« Cannot access 'M' before initialization ») | `unassignedGroups` référençait `pdfGroups` (useMemo) déclaré 130 lignes plus bas dans `NiveauxModal` — TDZ au rendu, invisible au build et aux tests | Hotfix #182 : useMemo remonté avant ses usages + règle TDZ ajoutée aux Règles de développement ci-dessus |
