import { Algorithm, hash, verify } from "@node-rs/argon2";

/**
 * Contraseñas del panel con Argon2id.
 *
 * Sustituye a PBKDF2, que era lo único que cabía en Workers. Argon2id es duro
 * en memoria, así que una GPU no lo acelera como aceleraba a PBKDF2.
 *
 * El hash resultante es una cadena PHC (`$argon2id$v=19$m=...,t=...,p=...$salt$hash`)
 * que ya lleva dentro el salt y el coste: subir los parámetros no invalida las
 * contraseñas antiguas, porque cada una se verifica con los suyos.
 */

/** Perfil de coste. Los valores por defecto siguen la recomendación de OWASP. */
export interface CosteArgon2 {
  /** Memoria en KiB. */
  memoryCost: number;
  /** Número de pasadas. */
  timeCost: number;
  parallelism: number;
}

export const COSTE_POR_DEFECTO: CosteArgon2 = {
  memoryCost: 19_456, // 19 MiB
  timeCost: 2,
  parallelism: 1,
};

/**
 * Coste mínimo, SOLO para las pruebas: el arnés crea decenas de cuentas y no
 * debe pagar el coste real. Nunca se usa fuera de test/.
 */
export const COSTE_DE_PRUEBAS: CosteArgon2 = {
  memoryCost: 512,
  timeCost: 1,
  parallelism: 1,
};

export function hashPassword(password: string, coste = COSTE_POR_DEFECTO): Promise<string> {
  return hash(password, { algorithm: Algorithm.Argon2id, ...coste });
}

/**
 * Verifica contra el hash guardado. Devuelve false ante un hash corrupto o de
 * otro formato en vez de lanzar: por esta puerta pasa el login, y una excepción
 * ahí sería un 500 que distingue "usuario raro" de "contraseña mala".
 */
export async function verificarPassword(password: string, phc: string): Promise<boolean> {
  try {
    return await verify(phc, password);
  } catch {
    return false;
  }
}
