import type { Db } from "../db";
import { generateToken, hashToken } from "./token";
import { ProfileDataSchema, idsDeMedios, type ProfileData, type Section } from "../schemas";
import { mediosDelPerfil, type MedioRow } from "./media-store";
import type { MediaKind } from "./sniff";
import { cuentaDelPerfil, pasesAbiertos } from "./cuentas";

/** Un medio ya resuelto contra la base: el cliente nunca dijo nada de esto. */
export interface ItemDePase {
  mediaId: string;
  kind: MediaKind;
  caption?: string;
  /** Dimensiones reales, para que el viewer reserve el hueco antes de cargar. */
  width: number | null;
  height: number | null;
  lqip: string | null;
}

export interface SeccionDePase {
  type: Section["type"];
  title?: string;
  body?: string;
  items: ItemDePase[];
}

export interface PassView {
  passId: string;
  profileId: string;
  displayName: string;
  brandColor: string | null;
  tagline?: string;
  intro?: string;
  sections: SeccionDePase[];
}

export class ProfileNotFoundError extends Error {}

/** El plan no da para más enlaces vivos a la vez. */
export class DemasiadosPasesError extends Error {
  constructor(readonly limite: number) {
    super(`el plan permite ${limite} pases abiertos a la vez`);
  }
}

/**
 * Crea un pase pendiente y devuelve el token en claro (solo se ve aquí).
 *
 * De paso toma la INSTANTÁNEA del contenido en `pass_media`. Es lo que da
 * significado exacto a "cuota por pase" —lo que el pase enseña es esto, no lo
 * que el perfil tenga el día que se abra— y, sobre todo, es la lista blanca de
 * lo que ese pase podrá pedir después a `/m/*`.
 */
export async function createPass(
  db: Db,
  opts: { profileId: string; ttlSeconds?: number }
): Promise<{ id: string; token: string; expiresAt: number }> {
  // Un perfil congelado no genera pases: está de camino a borrarse, y un enlace
  // que caduca antes de que lo abran es peor que no dar ninguno.
  const profile = await db.one<{ id: string; data: unknown }>(
    `SELECT p.id, p.data FROM vistta.profiles p
     LEFT JOIN vistta.users u ON u.id = p.owner_id
     WHERE p.id = $1 AND p.status = 'activo'
       AND (p.owner_id IS NULL OR u.status = 'activa')`,
    [opts.profileId]
  );
  if (!profile) throw new ProfileNotFoundError(opts.profileId);

  const cuenta = await cuentaDelPerfil(db, opts.profileId);

  const token = generateToken();
  const tokenHash = await hashToken(token);
  const now = Date.now();
  const expiresAt = now + (opts.ttlSeconds ?? 900) * 1000; // 15 min por defecto para abrir
  const id = crypto.randomUUID();

  // Solo entran medios del propio perfil y ya confirmados: la instantánea no es
  // una copia del JSON del usuario, es el resultado de contrastarlo con la base.
  const medios = await mediosDelPerfil(
    db,
    opts.profileId,
    idsDeMedios(parseProfileData(profile.data))
  );

  await db.tx(async (tx) => {
    /*
     * El tercer invariante de concurrencia del proyecto, y falla igual que los
     * otros dos: sin bloquear la fila de la cuenta, una ráfaga de peticiones ve
     * todas el mismo recuento y se cuelan casi todas.
     *
     * Un perfil sin dueño (los de antes de que hubiera cuentas) no tiene plan
     * que aplicar: se deja pasar en vez de inventarle un límite.
     */
    // `pasesSimultaneos: null` es Bóveda: sin límite. Se sale del bloque entero
    // en vez de comparar contra un número grande, igual que la retención.
    const tope = cuenta?.limites.pasesSimultaneos;
    if (cuenta?.userId && tope !== null && tope !== undefined) {
      await tx.one(`SELECT id FROM vistta.users WHERE id = $1 FOR UPDATE`, [cuenta.userId]);
      const abiertos = await pasesAbiertos(tx, cuenta.userId, now);
      if (abiertos >= tope) throw new DemasiadosPasesError(tope);
    }

    await tx.query(
      `INSERT INTO vistta.passes (id, token_hash, profile_id, status, created_at, expires_at)
       VALUES ($1, $2, $3, 'pending', $4, $5)`,
      [id, tokenHash, opts.profileId, now, expiresAt]
    );
    if (medios.size > 0) {
      await tx.query(
        `INSERT INTO vistta.pass_media (pass_id, media_id)
         SELECT $1, unnest($2::text[])`,
        [id, [...medios.keys()]]
      );
    }
  });

  return { id, token, expiresAt };
}

/**
 * Consumo ATÓMICO de un solo uso: el UPDATE condicional es la única puerta.
 *
 * Solo la primera petición válida encuentra la fila en 'pending' y sin caducar,
 * así que solo ella obtiene rowCount = 1. Las demás reciben null, sea porque el
 * pase ya estaba usado, porque caducó o porque no existe: el mismo resultado
 * para los tres casos, para no filtrar cuál era.
 *
 * En PostgreSQL el UPDATE toma un bloqueo de fila y las peticiones simultáneas
 * se serializan sobre ella; la segunda reevalúa el WHERE con la fila ya
 * cambiada y no encuentra nada que actualizar.
 */
export async function consumePass(db: Db, token: string): Promise<PassView | null> {
  const tokenHash = await hashToken(token);
  const now = Date.now();

  const claimed = await db.one<{ id: string; profile_id: string }>(
    `UPDATE vistta.passes SET status = 'consumed', consumed_at = $1
     WHERE token_hash = $2 AND status = 'pending' AND expires_at > $1
     RETURNING id, profile_id`,
    [now, tokenHash]
  );

  if (!claimed) return null; // denegado

  // El perfil tiene que seguir activo. Si se congeló entre generar el enlace y
  // abrirlo, el cliente ve lo mismo que con un pase usado: para él es un enlace
  // que ya no vale, y no tiene por qué enterarse de la situación comercial de
  // quien se lo mandó.
  const profile = await db.one<{
    id: string;
    display_name: string;
    brand_color: string | null;
    data: unknown;
  }>(
    `SELECT p.id, p.display_name, p.brand_color, p.data
     FROM vistta.profiles p
     LEFT JOIN vistta.users u ON u.id = p.owner_id
     WHERE p.id = $1 AND p.status = 'activo'
       AND (p.owner_id IS NULL OR u.status = 'activa')`,
    [claimed.profile_id]
  );
  if (!profile) return null;

  const data = parseProfileData(profile.data);
  // Los medios salen de la instantánea del pase, no del JSON: si el perfil ha
  // cambiado desde que se generó el enlace, el pase sigue enseñando lo que se
  // le prometió al cliente, y solo eso.
  const medios = await mediosDelPase(db, claimed.id);

  return {
    passId: claimed.id,
    profileId: profile.id,
    displayName: profile.display_name,
    brandColor: profile.brand_color,
    tagline: data.tagline,
    intro: data.intro ?? data.bio,
    sections: resolverSecciones(normalizeSections(data), medios),
  };
}

/** Los medios que este pase tiene derecho a enseñar, por id. */
async function mediosDelPase(db: Db, passId: string): Promise<Map<string, MedioRow>> {
  const { rows } = await db.query<MedioRow>(
    `SELECT m.id, m.profile_id, m.storage_key, m.kind, m.mime, m.bytes,
            m.width, m.height, m.lqip, m.status
     FROM vistta.pass_media pm
     JOIN vistta.media m ON m.id = pm.media_id
     WHERE pm.pass_id = $1 AND m.status = 'ready'`,
    [passId]
  );
  return new Map(rows.map((r) => [r.id, r]));
}

/**
 * Cruza el contenido con los medios reales. Una referencia que no esté en la
 * instantánea simplemente no aparece: mejor una galería con un hueco menos que
 * una URL firmada para algo que no se ha comprobado de quién es.
 */
function resolverSecciones(sections: Section[], medios: Map<string, MedioRow>): SeccionDePase[] {
  return sections.map((section) => ({
    type: section.type,
    title: section.title,
    body: "body" in section ? section.body : undefined,
    items: !("items" in section)
      ? []
      : section.items.flatMap((item) => {
          const medio = medios.get(item.mediaId);
          if (!medio) return [];
          return [
            {
              mediaId: medio.id,
              kind: medio.kind,
              caption: item.caption,
              width: medio.width,
              height: medio.height,
              lqip: medio.lqip,
            },
          ];
        }),
  }));
}

/**
 * La columna es JSONB, así que `pg` ya devuelve un objeto. Aun así se valida:
 * lo que hay en la base lo escribió un cliente, y un perfil corrupto no puede
 * tumbar la apertura de un pase (que además ya se ha consumido).
 */
export function parseProfileData(raw: unknown): ProfileData {
  const parsed = ProfileDataSchema.safeParse(raw);
  return parsed.success ? parsed.data : { sections: [] };
}

/** Un perfil guardado con el formato antiguo (bio + media) se ve como uno nuevo. */
function normalizeSections(data: ProfileData): Section[] {
  if (data.sections.length) return data.sections;
  const heredadas: Section[] = [];
  if (data.media?.length) heredadas.push({ type: "galeria", items: data.media });
  return heredadas;
}
