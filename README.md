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

L'écran se met à jour en temps réel (Server-Sent Events sur `/display/events`) : chaque modification enregistrée dans l'admin, et chaque début ou fin de planification (vérifiée toutes les 15 s), lui est envoyée sans rechargement. En cas de coupure, il se reconnecte seul et rattrape les changements. La page des messages de l'admin montre l'écran en direct.

## Comptes utilisateurs

Il n'y a pas d'inscription publique. Le premier compte (administrateur) se crée en ligne de commande :

```bash
npm run user:create -- matthias "Matthias"                                   # en dev
docker compose exec app node dist/cli/create-user.js matthias "Matthias"    # en Docker
```

Les comptes suivants se gèrent dans **Paramètres › Utilisateurs** (administrateurs uniquement) : création avec un mot de passe provisoire à changer à la première connexion, changement de rôle, désactivation (ferme aussitôt les sessions), réinitialisation du mot de passe, suppression (les messages sont conservés).

| Rôle | Messages | Templates | Utilisateurs |
| --- | --- | --- | --- |
| Éditeur | ✓ | | |
| Administrateur | ✓ | ✓ | ✓ |

On ne peut ni se rétrograder, ni se désactiver, ni se supprimer soi-même, et il reste toujours au moins un administrateur actif. Chacun change son mot de passe depuis « Mon compte ».

## Déploiement (Docker + Traefik)

L'application se place derrière le Traefik existant du serveur, sur le même schéma que passbolt : réseau externe `proxy`, certificat wildcard servi par le file provider (`tls=true`, pas de certresolver), filtrage IP LAN + VPN, redirection HTTP vers HTTPS. Aucun port n'est publié sur l'hôte.

```bash
cd ~/docker
git clone https://github.com/Interfas-Dev/Interfas_display.git interfas-display
cd interfas-display
cp .env.example .env
# Renseigner SESSION_SECRET, DISPLAY_HOST, DISPLAY_ALLOWED_IPS,
# TRAEFIK_EP_HTTPS et TRAEFIK_EP_HTTP (reprendre ceux de ~/docker/passbolt/.env)
docker compose up -d --build
docker compose exec app node dist/cli/create-user.js matthias "Matthias"
```

Points d'attention :

- `DISPLAY_HOST` doit être couvert par le certificat wildcard et résolu par le DNS du LAN vers le serveur.
- L'écran d'affichage doit être dans `DISPLAY_ALLOWED_IPS`, sinon Traefik renvoie 403.
- Ne pas ajouter de middleware `compress` ni `buffering` : le flux temps réel `/display/events` (SSE) doit passer tel quel.
- En Docker, `COOKIE_SECURE` et `TRUST_PROXY` sont forcés à `true` : la connexion à l'admin ne fonctionne donc qu'en HTTPS.

La base SQLite est stockée dans le volume Docker `interfas-data` (préfixé par le nom du dossier, à sauvegarder). C'est le même que dans la première version : un `docker compose up -d --build` dans le même dossier conserve les comptes et les messages.

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
