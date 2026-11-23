# Interfas Display

Outil d'affichage de messages pour l'écran de l'atelier, hébergé en local.

- `/display` : page plein écran pour l'écran de l'atelier (sans connexion, réseau local uniquement).
- `/admin` : espace d'administration pour gérer les messages.
- `/health` : vérification de l'état du service.

## Stack

Node.js 22, TypeScript, Fastify, SQLite (`better-sqlite3`), vues EJS, Docker.

## Développement

```bash
cp .env.example .env
npm install
npm run dev        # serveur avec rechargement automatique sur http://localhost:3000
npm test           # tests
npm run typecheck  # vérification TypeScript
```

## Déploiement (Docker)

```bash
cp .env.example .env
# Générer un secret : node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
# puis le mettre dans SESSION_SECRET
docker compose up -d --build
```

La base SQLite est stockée dans le volume Docker `interfas-data`.

## Structure

```
src/
  index.ts          point d'entrée
  app.ts            construction de l'application Fastify
  config.ts         lecture de la configuration (variables d'environnement)
  db/               connexion SQLite et migrations
  routes/           routes (display, admin, health)
views/              templates EJS
public/             CSS et JS servis au navigateur
test/               tests (vitest)
```
