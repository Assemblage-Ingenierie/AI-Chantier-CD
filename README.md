# ChantierAI Prototype

Prototype d'application front-end statique pour le suivi de visites chantier, export PDF et annotations de plans.

## Contenu

- `index.html` contient l'application complète en un seul fichier.
- `.github/workflows/deploy-pages.yml` publie automatiquement la branche `main` sur GitHub Pages.

## Déploiement GitHub Pages

1. Créer un repository GitHub et y pousser la branche `main`.
2. Dans `Settings > Pages`, laisser `GitHub Actions` comme source de déploiement.
3. Chaque `push` sur `main` republiera automatiquement l'application.

## Limites actuelles du prototype

- La persistance locale repose sur `localStorage` en hébergement statique. Les données restent donc liées au navigateur de l'utilisateur.
- Les fonctionnalités IA présentes dans le prototype appellent directement l'API Anthropic depuis le navigateur. Ce mode n'est pas adapté à un déploiement public sur GitHub Pages sans backend intermédiaire.
- Le code est un export compilé React inline. Il fonctionne comme prototype, mais reste difficile à maintenir tant qu'il n'est pas refactoré en source modulaire.

## Recommandations de suite

- Extraire le prototype vers un projet source (`src/`, composants, styles, build).
- Déporter les appels IA vers une API serveur ou une fonction serverless.
- Ajouter une vraie stratégie de tests et de validation avant diffusion plus large.

