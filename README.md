# Interfas Display

Outil d'affichage de messages pour l'écran de l'atelier, hébergé en local.

- `/display` : page plein écran pour l'écran de l'atelier (sans connexion, réseau local uniquement).
- `/admin` : espace d'administration pour gérer les messages.
- `/health` : vérification de l'état du service.

## Stack

Node.js 22, TypeScript, Fastify, SQLite (`better-sqlite3`), vues EJS, Docker.
Mots de passe hachés en argon2id, sessions stockées en base avec cookie signé `HttpOnly` + `SameSite=Strict`, limitation à 10 tentatives de connexion par minute.

## Développement

```bash
cp .env.example .env
npm install
npm run dev        # serveur avec rechargement automatique sur http://localhost:3000
npm test           # tests
npm run typecheck  # vérification TypeScript
```

## Comptes utilisateurs

Il n'y a pas d'inscription publique. Les comptes sont créés en ligne de commande :

```bash
npm run user:create -- matthias "Matthias"                                   # en dev
docker compose exec app node dist/cli/create-user.js matthias "Matthias"    # en Docker
```

Le mot de passe (10 caractères minimum) est demandé de façon masquée. Chacun peut ensuite le changer depuis « Mon compte » dans l'admin.

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
  auth/             mots de passe, utilisateurs, sessions, plugin d'authentification
  cli/              commandes (création d'utilisateur)
  db/               connexion SQLite et migrations
  routes/           routes (display, admin, health)
views/              templates EJS
public/             CSS et JS servis au navigateur
test/               tests (vitest)
```
