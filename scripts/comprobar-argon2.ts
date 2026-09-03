#!/usr/bin/env node
/**
 * ¿Puede esta imagen cifrar y verificar una contraseña?
 *
 * Hermana de `comprobar-fuentes.ts`, y por el mismo motivo: argon2 es un
 * binario nativo (`@node-rs/argon2`) y NINGÚN paso de la construcción lo
 * ejercitaba. Sharp sí, porque la comprobación de fuentes lo usa; argon2 era el
 * hueco. Un binario que faltase, que no case con la libc de la base o que se
 * resolviera para otra arquitectura no daría la cara al construir ni al
 * arrancar: daría la cara en el PRIMER INTENTO DE LOGIN de producción, que es
 * el peor sitio y el peor momento.
 *
 * Se comprueba también que el algoritmo sigue siendo argon2id. Es el que el
 * proyecto se ha comprometido a usar, y es un valor por defecto de la
 * biblioteca: si un día cambia, aquí se ve; en producción, no.
 */
const CONTRASENA = "comprobacion de la construccion";

function morir(motivo: string, detalle: string[]): never {
  console.error([`ARGON2 NO FUNCIONA: ${motivo}.`, "", ...detalle].join("\n"));
  process.exit(1);
}

// El módulo se carga DENTRO del try, y por eso con `import()` y no con un
// `import` de cabecera: el fallo más probable —que no haya binario nativo para
// esta plataforma— ocurre al cargar, y un import estático revienta antes de
// llegar aquí. Se comprobó quitando el `.node` de la imagen: la construcción
// caía igual, pero escupiendo un volcado de pila de cuarenta líneas en vez de
// decir qué pasa. Quien lea esto en un log de CI merece la frase, no la pila.
let hash: (c: string) => Promise<string>;
let verify: (h: string, c: string) => Promise<boolean>;
try {
  ({ hash, verify } = await import("@node-rs/argon2"));
} catch (e) {
  morir("el módulo nativo no ha cargado", [
    "No hay binario de @node-rs/argon2 para esta plataforma. Suele ser que la",
    "instalación resolvió otra arquitectura, u otra libc que la de esta imagen",
    "base (glibc en bookworm, musl en alpine).",
    "",
    String(e),
  ]);
}

let cifrada: string;
try {
  cifrada = await hash(CONTRASENA);
} catch (e) {
  morir("no se ha podido cifrar", ["El módulo cargó pero cifrar falla.", "", String(e)]);
}

// `$argon2id$v=19$...`: el algoritmo es el segundo campo.
const algoritmo = cifrada.split("$")[1];
if (algoritmo !== "argon2id") {
  morir(`el algoritmo es ${algoritmo}, no argon2id`, [
    "El panel se apoya en argon2id. Si la biblioteca ha cambiado su valor por",
    "defecto, hay que pasarle el algoritmo de forma explícita en src/lib/auth.ts.",
  ]);
}

if (!(await verify(cifrada, CONTRASENA))) {
  morir("no reconoce la contraseña correcta", [
    "Cifrar funciona y verificar no: nadie podría entrar al panel.",
  ]);
}

// Que acepte la buena no basta: una verificación que devolviera `true` siempre
// también la aceptaría, y dejaría entrar a cualquiera.
if (await verify(cifrada, "una contrasena distinta")) {
  morir("ACEPTA UNA CONTRASEÑA INCORRECTA", [
    "Esto no es un fallo de despliegue, es un agujero: la verificación estaría",
    "devolviendo cierto pase lo que pase. No despliegues esta imagen.",
  ]);
}

console.log(`Argon2 disponible: ${algoritmo}, verifica la buena y rechaza la mala.`);

// Sin ningún `import` de cabecera este archivo dejaría de ser un módulo para
// TypeScript, y entonces el `await` de arriba no está permitido. Es el precio
// de cargar argon2 dentro del try, y es barato.
export {};
