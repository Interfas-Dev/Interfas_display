/**
 * Crée un compte administrateur.
 *   En dev    : npm run user:create -- <identifiant> ["Nom affiché"]
 *   En Docker : docker compose exec app node dist/cli/create-user.js <identifiant> ["Nom affiché"]
 * Le mot de passe est demandé de façon masquée (ou lu depuis INTERFAS_PASSWORD).
 * Sert à créer le premier compte ; les suivants se créent dans Paramètres › Utilisateurs.
 */
import readline from 'node:readline';
import { Writable } from 'node:stream';
import { loadConfig } from '../config.js';
import { openDatabase } from '../db/index.js';
import { createUser } from '../auth/users.js';

function askHidden(question: string): Promise<string> {
  let muted = false;
  const output = new Writable({
    write(chunk, _enc, cb) {
      if (!muted) process.stdout.write(chunk);
      cb();
    },
  });
  const rl = readline.createInterface({ input: process.stdin, output, terminal: true });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
    muted = true;
  });
}

const [username, displayName] = process.argv.slice(2);
if (!username) {
  console.error('Usage : create-user <identifiant> ["Nom affiché"]');
  process.exit(1);
}

let password = process.env.INTERFAS_PASSWORD;
if (!password) {
  password = await askHidden('Mot de passe : ');
  const confirm = await askHidden('Confirmer : ');
  if (password !== confirm) {
    console.error('Les mots de passe ne correspondent pas.');
    process.exit(1);
  }
}

const db = openDatabase(loadConfig().databasePath);
try {
  const user = await createUser(db, { username, displayName, password });
  console.log(`Utilisateur « ${user.username} » créé.`);
} catch (err) {
  console.error((err as Error).message);
  process.exitCode = 1;
} finally {
  db.close();
}
