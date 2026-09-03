#!/usr/bin/env node
/**
 * El ciclo completo contra el bucket de verdad: SUBIR → LEER → BORRAR.
 *
 * Existe porque el adaptador de R2 (`src/storage/r2.ts`) firma SigV4 a mano y
 * sus pruebas usan un `fetch` de mentira: comprueban qué petición SALE, no que
 * alguien la acepte. La firma se verificó contra MinIO, que valida igual, pero
 * MinIO no es R2. Esto es lo que cierra esa distancia, y hay que ejecutarlo una
 * vez, con el bucket real y SIN CLIENTES DENTRO.
 *
 * Usa el adaptador de producción a propósito: si aquí se reimplementara la
 * firma, se estaría probando otro código que el que sirve las fotos.
 *
 *   pnpm r2:verificar
 *
 * Y en el servidor, donde vive el .env con las credenciales, desde la imagen:
 *
 *   docker compose -f compose.prod.yml run --rm api node dist/verificar-r2.js
 *
 * No toca ningún medio: escribe una clave suya bajo `verificacion/` y la borra,
 * también si algo falla por el camino.
 */
import { createR2Storage } from "../src/storage/r2";

const CLAVE = `verificacion/${new Date().toISOString().replace(/[:.]/g, "-")}-${Math.random()
  .toString(36)
  .slice(2, 10)}.bin`;
const TIPO = "application/octet-stream";
// Bytes con estructura: si volviera otra cosa, se nota en qué posición.
const CONTENIDO = new Uint8Array(Array.from({ length: 256 }, (_, i) => i));

function fallar(paso: string, motivo: string, pistas: string[]): never {
  console.error(`\n✗ ${paso}: ${motivo}\n`);
  for (const p of pistas) console.error(`  · ${p}`);
  console.error("");
  process.exit(1);
}

/** El cuerpo del error de S3 trae un `<Code>` que dice qué pasa de verdad. */
function diagnostico(estado: number, cuerpo: string): string[] {
  const codigo = cuerpo.match(/<Code>([^<]+)<\/Code>/)?.[1] ?? "";
  const tabla: Record<string, string> = {
    SignatureDoesNotMatch:
      "R2_SECRET_ACCESS_KEY no es la que corresponde a esa clave de acceso (o el reloj de esta máquina va desviado más de 15 minutos).",
    InvalidAccessKeyId: "R2_ACCESS_KEY_ID no existe en esa cuenta.",
    // R2 no responde como MinIO a una clave de acceso desconocida, y esto salió
    // el 2026-09-03 probando contra R2 de verdad: MinIO da 403
    // `InvalidAccessKeyId` y R2 da 401 `Unauthorized`. Sin esta línea, el
    // diagnóstico se quedaba en «R2 responde 401» en el caso más común al
    // estrenar credenciales.
    Unauthorized: "R2_ACCESS_KEY_ID no existe en esa cuenta, o el token se ha revocado o caducado.",
    AccessDenied:
      "El token existe pero no puede hacer esto: comprueba que es de tipo «Object Read & Write» y que su alcance incluye ESTE bucket.",
    NoSuchBucket: `El bucket «${process.env.R2_BUCKET}» no existe en esa cuenta. Ojo: el nombre distingue mayúsculas.`,
    NoSuchKey: "El objeto no está donde se esperaba.",
  };
  const pistas: string[] = [];
  if (codigo) pistas.push(`R2 responde ${estado} ${codigo}.`);
  else pistas.push(`R2 responde ${estado}.`);
  if (tabla[codigo]) pistas.push(tabla[codigo]);

  if (estado === 401 || estado === 403) {
    pistas.push("Las credenciales NO se imprimen aquí; revísalas en el .env, no en este log.");
  }
  return pistas;
}

const falta = ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET"].filter(
  (v) => !process.env[v]?.trim()
);
if (falta.length > 0) {
  fallar("configuración", `faltan ${falta.join(", ")}`, [
    "Las cuatro salen del panel de Cloudflare: R2 → el bucket → Manage API tokens.",
    "En el servidor están en el .env; aquí puedes pasarlas por delante del comando.",
  ]);
}

// El último cuerpo de error, para poder diagnosticar. El adaptador solo propaga
// el código de estado, que no basta para saber si es la clave o el permiso.
let ultimoEstado = 0;
let ultimoCuerpo = "";
const fetchConDiagnostico: typeof fetch = async (url, init) => {
  const res = await fetch(url as string, init);
  if (!res.ok) {
    ultimoEstado = res.status;
    ultimoCuerpo = await res.clone().text();
  }
  return res;
};

const endpoint = process.env.R2_ENDPOINT?.trim();
const storage = createR2Storage({
  accountId: process.env.R2_ACCOUNT_ID!,
  accessKeyId: process.env.R2_ACCESS_KEY_ID!,
  secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  bucket: process.env.R2_BUCKET!,
  // R2_ENDPOINT y R2_REGION solo se usan para probar contra otro servidor
  // compatible con S3 (MinIO). Contra R2 se dejan sin poner.
  endpoint,
  region: process.env.R2_REGION?.trim(),
  fetchImpl: fetchConDiagnostico,
});

console.log(`Bucket   : ${process.env.R2_BUCKET}`);
console.log(`Endpoint : ${endpoint ?? `https://<cuenta>.r2.cloudflarestorage.com`}`);
console.log(`Clave    : ${CLAVE}\n`);

async function limpiar(): Promise<void> {
  try {
    await storage.delete(CLAVE);
  } catch {
    console.error(`  aviso: no se ha podido borrar ${CLAVE}. Bórralo a mano.`);
  }
}

// --- 1. SUBIR ----------------------------------------------------------------
try {
  await storage.put(CLAVE, CONTENIDO, TIPO);
  console.log("✓ subir");
} catch {
  fallar("subir", "el objeto no se ha guardado", diagnostico(ultimoEstado, ultimoCuerpo));
}

// --- 2. LEER -----------------------------------------------------------------
try {
  const leido = await storage.get(CLAVE);
  if (!leido) {
    await limpiar();
    fallar("leer", "el objeto que se acaba de subir no aparece", [
      "Subir devolvió bien y leer devuelve vacío: puede ser un bucket distinto del que crees.",
    ]);
  }
  if (leido.bytes.length !== CONTENIDO.length) {
    await limpiar();
    fallar("leer", `vuelven ${leido.bytes.length} bytes de ${CONTENIDO.length}`, [
      "Los bytes que salen no son los que entraron. NO sirvas medios con esta configuración.",
    ]);
  }
  const distinto = CONTENIDO.findIndex((b, i) => leido.bytes[i] !== b);
  if (distinto !== -1) {
    await limpiar();
    fallar("leer", `el byte ${distinto} vuelve cambiado`, [
      "El contenido no se conserva. NO sirvas medios con esta configuración.",
    ]);
  }
  console.log(`✓ leer (${leido.bytes.length} bytes idénticos, tipo ${leido.contentType})`);
} catch (e) {
  if (e instanceof Error && e.name === "StorageError") {
    await limpiar();
    fallar("leer", "no se ha podido leer", diagnostico(ultimoEstado, ultimoCuerpo));
  }
  throw e;
}

// --- 3. UNA CLAVE QUE NO EXISTE DEVUELVE null, NO UN ERROR --------------------
// El reaper de huérfanos se apoya en esto: si lanzara, un medio ya borrado
// dejaría el trabajo en error para siempre.
try {
  const fantasma = await storage.get(`${CLAVE}.no-existe`);
  if (fantasma !== null) {
    await limpiar();
    fallar("clave inexistente", "devuelve contenido en vez de null", [
      "Algo está sirviendo una respuesta que no corresponde a esa clave.",
    ]);
  }
  console.log("✓ una clave que no existe devuelve null");
} catch {
  await limpiar();
  fallar("clave inexistente", "lanza error en vez de devolver null", [
    "El reaper de huérfanos se apoya en que leer lo que no está devuelva null.",
    ...diagnostico(ultimoEstado, ultimoCuerpo),
  ]);
}

// --- 4. BORRAR ---------------------------------------------------------------
try {
  await storage.delete(CLAVE);
  console.log("✓ borrar");
} catch {
  fallar("borrar", "el objeto no se ha podido borrar", [
    "Subir y leer funcionan, así que el token probablemente sea de solo lectura.",
    `Ha quedado un objeto en el bucket; bórralo a mano: ${CLAVE}`,
    "Con un token que no borra, la purga y el reaper no pueden limpiar nada: el bucket",
    "crece para siempre y la factura con él.",
    ...diagnostico(ultimoEstado, ultimoCuerpo),
  ]);
}

// --- 5. Y BORRAR DE VERDAD, NO SOLO DEVOLVER BIEN ----------------------------
const despues = await storage.get(CLAVE);
if (despues !== null) {
  fallar("borrar", "el objeto sigue ahí después de borrarlo", [
    `Bórralo a mano: ${CLAVE}`,
    "Un borrado que dice que sí y no borra deja crecer el bucket y la factura.",
  ]);
}
console.log("✓ ya no está\n");

console.log("R2 responde al ciclo completo: subir, leer, borrar.");
