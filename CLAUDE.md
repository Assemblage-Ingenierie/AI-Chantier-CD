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

## Règles de développement

- Ne jamais modifier le schéma Supabase sans migration dans `supabase/migrations/`
- Le cache localStorage utilise la clé `chantierai_v12`
- `useProjets.js` gère tout l'état des projets — ne pas dupliquer cette logique
- Toujours tester que `remoteLoaded` est bien géré si on touche au chargement
