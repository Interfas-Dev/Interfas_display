import argon2 from 'argon2';

export const MIN_PASSWORD_LENGTH = 10;

export function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, { type: argon2.argon2id });
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

// Hash factice utilisé quand l'utilisateur n'existe pas, pour que la réponse
// prenne le même temps et ne révèle pas quels identifiants existent.
let dummyHash: Promise<string> | undefined;
export function getDummyHash(): Promise<string> {
  dummyHash ??= hashPassword('mot-de-passe-factice-pour-timing');
  return dummyHash;
}
