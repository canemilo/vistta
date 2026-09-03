import type { Db } from "../db";
import type { Storage } from "../storage/port";
import { LIMITE_POR_TIPO, detectarTipo, type MediaKind } from "./sniff";
import { derivados } from "./watermark";
import { cuentaDelPerfil } from "./cuentas";

/**
 * El modelo de medios. La regla que ordena todo el módulo:
 *
 *   **la fila manda, no el objeto.**
 *
 * Un medio existe porque hay fila en `vistta.media`; la fila dice de qué perfil
 * es, cuántos bytes ocupa de verdad y si el backend ha llegado a mirarlos. El
 * JSON del perfil solo guarda ids. Antes guardaba claves de almacenamiento, y
 * por eso un usuario podía escribir la clave de otro y servirla.
 */

/*
 * La cuota ya no es una constante: sale del plan del dueño del perfil, y vive
 * en src/lib/planes.ts con el resto de las cifras. Hasta el bloque E era un
 * número escrito aquí, y eso obligaba a tocar este archivo para cambiar de
 * oferta comercial.
 */

/** Cuánto vive una reserva sin confirmar antes de que el reaper se la lleve. */
export const TTL_RESERVA_MS = 30 * 60 * 1000;

/**
 * Cuántas reservas sin confirmar puede tener un perfil a la vez.
 *
 * La cuota en bytes no basta para frenar esto: reservando un byte cada vez, una
 * sesión válida puede crear millones de filas sin acercarse al tope de 200 MB.
 * El número está puesto para que quepa una selección múltiple grande en el panel
 * y no mucho más.
 */
export const MAX_RESERVAS_ABIERTAS = 60;

export interface MedioRow {
  id: string;
  profile_id: string;
  storage_key: string;
  kind: MediaKind;
  mime: string;
  bytes: number;
  width: number | null;
  height: number | null;
  lqip: string | null;
  status: "pending" | "ready" | "failed";
}

const COLUMNAS = `id, profile_id, storage_key, kind, mime, bytes, width, height, lqip, status`;

export class CuotaExcedidaError extends Error {}
export class DemasiadasReservasError extends Error {}
export class ReservaNoValidaError extends Error {}

/** Bytes comprometidos por un perfil: lo confirmado más lo reservado. */
export async function cuotaUsada(db: Db, profileId: string): Promise<number> {
  const fila = await db.one<{ total: number }>(
    `SELECT COALESCE(SUM(bytes), 0)::bigint AS total FROM vistta.media
     WHERE profile_id = $1 AND status <> 'failed'`,
    [profileId]
  );
  return fila?.total ?? 0;
}

/**
 * Reserva sitio para un medio ANTES de aceptar un solo byte.
 *
 * La reserva ocupa cuota con el tamaño DECLARADO, que no vale nada como dato
 * pero sí como freno: sin ella, mil peticiones concurrentes pasarían la
 * comprobación de cuota a la vez y la subida real llegaría cuando ya no hay
 * nada que hacer. Al confirmar se sustituye por los bytes reales.
 *
 * Va en transacción con la fila del perfil bloqueada: dos reservas simultáneas
 * del mismo perfil se serializan, así que la suma que ve la segunda ya incluye
 * a la primera. Sin el bloqueo, una ráfaga se cuela entera.
 */
export async function reservarMedio(
  db: Db,
  opts: { profileId: string; kind: MediaKind; declaredBytes: number }
): Promise<{ mediaId: string; storageKey: string }> {
  if (opts.declaredBytes <= 0 || opts.declaredBytes > LIMITE_POR_TIPO[opts.kind]) {
    throw new ReservaNoValidaError("tamaño fuera del límite del tipo");
  }

  const cuenta = await cuentaDelPerfil(db, opts.profileId);
  if (!cuenta) throw new ReservaNoValidaError("perfil no encontrado");
  const cuota = cuenta.limites.cuotaPorPerfil;

  return db.tx(async (tx) => {
    // Solo los perfiles activos admiten subidas. Uno congelado está de camino a
    // borrarse: dejar meter cosas dentro sería cobrarle sitio a alguien por algo
    // que va a desaparecer.
    const perfil = await tx.one<{ id: string }>(
      `SELECT id FROM vistta.profiles WHERE id = $1 AND status = 'activo' FOR UPDATE`,
      [opts.profileId]
    );
    if (!perfil) throw new ReservaNoValidaError("perfil no encontrado o congelado");

    const abiertas = await tx.one<{ n: number }>(
      `SELECT count(*)::int AS n FROM vistta.media WHERE profile_id = $1 AND status = 'pending'`,
      [opts.profileId]
    );
    if ((abiertas?.n ?? 0) >= MAX_RESERVAS_ABIERTAS) {
      throw new DemasiadasReservasError(`${abiertas?.n} reservas sin confirmar`);
    }

    const usada = await cuotaUsada(tx, opts.profileId);
    if (usada + opts.declaredBytes > cuota) {
      throw new CuotaExcedidaError(`${usada} + ${opts.declaredBytes} > ${cuota}`);
    }

    const mediaId = crypto.randomUUID();
    // La clave la genera el servidor y sale del id, no del nombre que trae el
    // cliente: un nombre de archivo ajeno no puede acabar en una ruta nuestra.
    // Sin extensión a propósito: el tipo real vive en la columna `mime`, que es
    // lo que se sirve, y una extensión solo daría una segunda verdad que
    // mantener de acuerdo con la primera.
    const storageKey = `u/${opts.profileId}/${mediaId}`;
    await tx.query(
      `INSERT INTO vistta.media (id, profile_id, storage_key, kind, mime, bytes, status, created_at)
       VALUES ($1, $2, $3, $4, '', $5, 'pending', $6)`,
      [mediaId, opts.profileId, storageKey, opts.kind, opts.declaredBytes, Date.now()]
    );
    return { mediaId, storageKey };
  });
}

/** La reserva que espera bytes, si sigue viva y es de ese perfil. */
export async function reservaPendiente(
  db: Db,
  mediaId: string,
  profileId: string
): Promise<MedioRow | null> {
  return db.one<MedioRow>(
    `SELECT ${COLUMNAS} FROM vistta.media
     WHERE id = $1 AND profile_id = $2 AND status = 'pending'`,
    [mediaId, profileId]
  );
}

export type ResultadoConfirmacion =
  { ok: true; medio: MedioRow } | { ok: false; motivo: "tipo" | "tamano" | "cuota" | "reserva" };

/**
 * Acepta los bytes de una reserva: los identifica, los mide y solo entonces los
 * guarda y marca el medio como servible.
 *
 * Aquí está la frase entera del bloque D: **lo que el backend no ha
 * inspeccionado no se sirve nunca**. Mientras el medio siga en 'pending' no
 * tiene bytes que valgan y `/m/*` no lo mira. Si los bytes no son lo que decían,
 * queda en 'failed' y el objeto no llega a existir.
 */
export async function confirmarMedio(
  db: Db,
  storage: Storage,
  opts: { mediaId: string; profileId: string; bytes: Uint8Array }
): Promise<ResultadoConfirmacion> {
  const reserva = await reservaPendiente(db, opts.mediaId, opts.profileId);
  if (!reserva) return { ok: false, motivo: "reserva" };

  const real = detectarTipo(opts.bytes);
  // Ni tipo irreconocible, ni un vídeo colado en el hueco de una imagen: el
  // tope de tamaño y el tratamiento posterior dependen del tipo, así que tiene
  // que ser el que se reservó.
  if (!real || real.kind !== reserva.kind) {
    await marcarFallido(db, opts.mediaId);
    return { ok: false, motivo: "tipo" };
  }

  const bytesReales = opts.bytes.byteLength;
  if (bytesReales === 0 || bytesReales > LIMITE_POR_TIPO[real.kind]) {
    await marcarFallido(db, opts.mediaId);
    return { ok: false, motivo: "tamano" };
  }

  /*
   * Dimensiones y miniatura AQUÍ, en la misma petición, y no en la cola.
   *
   * El plan del bloque D las dejaba para un trabajo en segundo plano, pero los
   * bytes ya están en memoria y Sharp ya está cargado: calcularlas ahora cuesta
   * unos milisegundos y, sobre todo, quita de en medio un estado entero —el
   * medio 'ready' del que todavía no se sabe cuánto mide—. Con esto, 'ready'
   * significa siempre "el backend lo ha mirado Y sabe cómo es". La cola se
   * queda para lo que de verdad no puede ir en la petición: el reaper.
   *
   * Si Sharp no puede con el archivo, no se acepta: un contenedor de imagen que
   * ni siquiera se decodifica no es una imagen que podamos marcar después.
   */
  let medidas: { width: number; height: number; lqip: string } | null = null;
  if (real.kind === "image") {
    try {
      medidas = await derivados(opts.bytes);
    } catch {
      await marcarFallido(db, opts.mediaId);
      return { ok: false, motivo: "tipo" };
    }
  }

  // La cuota se decide con los bytes reales, no con los declarados: declarar un
  // kilobyte y subir diez megas es exactamente el ataque que esto para.
  const cuenta = await cuentaDelPerfil(db, opts.profileId);
  const cuota = cuenta?.limites.cuotaPorPerfil ?? 0;

  const confirmado = await db.tx(async (tx) => {
    await tx.one(`SELECT id FROM vistta.profiles WHERE id = $1 FOR UPDATE`, [opts.profileId]);
    const otros = await tx.one<{ total: number }>(
      `SELECT COALESCE(SUM(bytes), 0)::bigint AS total FROM vistta.media
       WHERE profile_id = $1 AND status <> 'failed' AND id <> $2`,
      [opts.profileId, opts.mediaId]
    );
    if ((otros?.total ?? 0) + bytesReales > cuota) return null;

    return tx.one<MedioRow>(
      `UPDATE vistta.media
       SET mime = $1, bytes = $2, status = 'ready', confirmed_at = $3,
           width = $4, height = $5, lqip = $6
       WHERE id = $7 AND status = 'pending'
       RETURNING ${COLUMNAS}`,
      [
        real.mime,
        bytesReales,
        Date.now(),
        medidas?.width ?? null,
        medidas?.height ?? null,
        medidas?.lqip ?? null,
        opts.mediaId,
      ]
    );
  });

  if (!confirmado) {
    await marcarFallido(db, opts.mediaId);
    return { ok: false, motivo: "cuota" };
  }

  // Los bytes van al almacenamiento DESPUÉS de pasar todas las comprobaciones.
  // Si el `put` falla, la fila se queda en 'ready' apuntando a un objeto que no
  // está: `/m/*` devuelve 404 y el reaper la recoge. Al revés —guardar primero
  // y validar luego— dejaría bytes sin identificar en el bucket.
  await storage.put(reserva.storage_key, opts.bytes, real.mime);
  return { ok: true, medio: confirmado };
}

async function marcarFallido(db: Db, mediaId: string): Promise<void> {
  await db.query(
    `UPDATE vistta.media SET status = 'failed', bytes = 0 WHERE id = $1 AND status = 'pending'`,
    [mediaId]
  );
}

/**
 * De una lista de ids, los que son de ese perfil y están servibles.
 *
 * Es la comprobación que cierra el IDOR: al guardar un perfil, todo id que no
 * salga de aquí se rechaza. Nunca se da por buena una referencia solo porque
 * venga escrita en el JSON del usuario.
 */
export async function mediosDelPerfil(
  db: Db,
  profileId: string,
  ids: readonly string[]
): Promise<Map<string, MedioRow>> {
  if (ids.length === 0) return new Map();
  const { rows } = await db.query<MedioRow>(
    `SELECT ${COLUMNAS} FROM vistta.media
     WHERE profile_id = $1 AND status = 'ready' AND id = ANY($2::text[])`,
    [profileId, [...new Set(ids)]]
  );
  return new Map(rows.map((r) => [r.id, r]));
}

/**
 * El medio que un pase concreto puede pedir.
 *
 * La lista blanca es `pass_media`, la instantánea que se tomó al crear el pase.
 * Aunque alguien fabricase una firma válida, sin fila ahí no hay nada que
 * servir: la firma dice "esta URL la emitimos nosotros", y la instantánea dice
 * "y este pase tenía derecho a este medio".
 */
export async function medioDelPase(
  db: Db,
  passId: string,
  mediaId: string
): Promise<(MedioRow & { destinatario_ref: string | null }) | null> {
  // La referencia del destinatario sale en la MISMA consulta, y no en otra: por
  // aquí pasa cada visita a cada foto, y cada una relee el original para
  // marcarlo. Una segunda ida a la base por imagen se nota.
  return db.one<MedioRow & { destinatario_ref: string | null }>(
    `SELECT m.id, m.profile_id, m.storage_key, m.kind, m.mime, m.bytes,
            m.width, m.height, m.lqip, m.status, ps.destinatario_ref
     FROM vistta.pass_media pm
     JOIN vistta.media m   ON m.id = pm.media_id
     JOIN vistta.passes ps ON ps.id = pm.pass_id
     WHERE pm.pass_id = $1 AND pm.media_id = $2 AND m.status = 'ready'`,
    [passId, mediaId]
  );
}
