# Interfas Display

Outil d'affichage de messages pour l'écran de l'atelier, hébergé en local.

- `/display` : page plein écran pour l'écran de l'atelier (sans connexion, réseau local uniquement).
- `/admin` : espace d'administration pour gérer les messages.
- `/health` : vérification de l'état du service.

## Stack

Node.js 22, TypeScript, Fastify, SQLite (`better-sqlite3`), vues EJS, Docker.
Mots de passe hachés en argon2id, sessions stockées en base avec cookie signé `HttpOnly` + `SameSite=Strict`, limitation à 10 tentatives de connexion par minute.

## Charte graphique

L'interface suit la **Référence graphique INTERFAS / SYLHIA v1.0** (6 novembre 2026) : jetons de couleur dans `public/css/brand.css`, police Sora (SIL OFL 1.1) servie en local depuis `public/fonts/sora/`, arrondis de 8 px.

- Admin en thème clair (fond beige, texte noir chaud), écran de l'atelier en thème sombre (fond noir chaud, texte blanc).
- Le rouge de marque sert d'accent (boutons principaux, grands titres). Il ne signale jamais une erreur : les états (erreur, succès, actif/inactif) ont leurs propres couleurs et toujours un libellé ou un pictogramme.
- Petits textes sur beige en noir chaud ou `#5C574F`, jamais en rouge ni en grège. Texte sur aplat rouge toujours blanc.
- Aucun logo n'est utilisé (la charte n'en autorise pas de nouveau).

## Développement

```bash
cp .env.example .env
npm install
npm run dev        # compile l'éditeur puis lance le serveur sur http://localhost:3000
npm test           # tests
npm run typecheck  # vérification TypeScript
```

## Diffusion

Chaque message a une durée d'affichage (3 s à 5 min, 10 s par défaut) et une planification facultative : date et heure de début et de fin, jours de la semaine, plage horaire quotidienne (qui peut passer minuit). Tout est évalué dans le fuseau `TIMEZONE` (Europe/Paris par défaut). L'écran n'affiche que les messages en cours de diffusion.

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
  content/          messages et nettoyage du HTML
  routes/           routes (display, admin, messages, health)
client/             éditeur de texte riche (TipTap), compilé par esbuild vers public/build/
views/              templates EJS
public/             CSS et JS servis au navigateur
test/               tests (vitest)
```
