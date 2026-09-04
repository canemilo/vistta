import type { Db } from "../db";
import { generateToken, hashToken } from "./token";
import type { Presentacion } from "../schemas";
import { ProfileDataSchema, idsDeMedios, type ProfileData, type Section } from "../schemas";
import { mediosDelPerfil, type MedioRow } from "./media-store";
import type { MediaKind } from "./sniff";
import { cuentaDelPerfil, pasesAbiertos } from "./cuentas";
import {
  PLAZO_NUEVOS_POR_DEFECTO_MS,
  PLAZO_UNICO_MAX_MS,
  VENTANA_POR_DEFECTO_MS,
  type ModoDePase,
} from "./planes";

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
  /** Cómo se presentan las fotos. Ausente = cuadrícula. */
  display?: Presentacion;
}

export interface PassView {
  passId: string;
  /** A quién se le enseña, si el cliente lo escribió. Va en la marca de agua. */
  destinatarioRef: string | null;
  /** Aspecto con el que hay que pintar el documento. */
  tema: TemaDePase;
  /**
   * Si el plan de quien generó el pase registra actividad de lectura.
   *
   * Se resuelve al abrir y no en la ruta, para que la decisión salga del mismo
   * sitio que el resto de límites del plan y no de una consulta suelta.
   */
  mideLectura: boolean;
  profileId: string;
  displayName: string;
  brandColor: string | null;
  /** Logotipo del cliente, ya reducido, como data URI. Null si no puso ninguno. */
  logo: string | null;
  tagline?: string;
  intro?: string;
  sections: SeccionDePase[];
}

/** Aspecto con el que se enseña un pase. Lo elige quien lo manda. */
export type TemaDePase = "oscuro" | "claro";

export class ProfileNotFoundError extends Error {}

/** El plan de esta cuenta no admite ese modo de pase. */
export class ModoNoPermitidoError extends Error {
  constructor(readonly modo: ModoDePase) {
    super(`el plan no admite el modo ${modo}`);
  }
}

/** El modo es válido para el plan, pero el número pedido se pasa de su tope. */
export class ParametroDeModoError extends Error {
  constructor(
    readonly campo: "maxAccesos" | "ventanaMs" | "ttlSeconds",
    readonly maximo: number
  ) {
    super(`${campo} no puede pasar de ${maximo}`);
  }
}

/**
 * QUÉ SIGNIFICA QUE UN PASE SIGA ABRIÉNDOSE. Un solo sitio, tres usos.
 *
 * Lo usan el consumo (`consumePass`), el recuento de pases vivos del plan
 * (`pasesAbiertos`) y la purga de medios (`purga.ts`). Tienen que decir
 * exactamente lo mismo, y por eso no se escribe tres veces: si divergen, la
 * que se equivoca es la purga, y equivocarse ahí significa borrar las fotos de
 * un medio que un pase todavía puede pedir. El cliente abre su enlace y no hay
 * nada dentro.
 *
 * Las dos mitades del plazo, que es la parte que se confunde:
 *   - sin abrir  → manda `expires_at`, el plazo para la primera apertura;
 *   - ya abierto → manda `valido_hasta`, la ventana desde esa primera apertura.
 */
export function pasAbribleSql(alias: string, ahora: string): string {
  return `${alias}.status = 'pending'
     AND ( (${alias}.primera_apertura_at IS NULL     AND ${alias}.expires_at   > ${ahora})
        OR (${alias}.primera_apertura_at IS NOT NULL AND ${alias}.valido_hasta > ${ahora}) )
     AND (${alias}.modo <> 'accesos' OR ${alias}.accesos_usados < ${alias}.max_accesos)`;
}

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
export interface OpcionesDePase {
  profileId: string;
  ttlSeconds?: number;
  modo?: ModoDePase;
  maxAccesos?: number;
  ventanaMs?: number;
  /** A quién se le enseña. Se pinta DENTRO de la imagen, en cada visita. */
  destinatarioRef?: string;
  /** Nota privada de quien manda el pase. No sale del panel de su dueño. */
  destinatarioNota?: string;
  /** Aspecto con el que se enseña el documento. Por defecto, oscuro. */
  tema?: TemaDePase;
}

export async function createPass(
  db: Db,
  opts: OpcionesDePase
): Promise<{ id: string; token: string; expiresAt: number; modo: ModoDePase }> {
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

  const modo: ModoDePase = opts.modo ?? "unico";

  /*
   * Los topes del plan. Van aquí y no en el esquema de Zod porque hacen falta
   * la cuenta y su plan, y porque hay que distinguir dos negativas distintas:
   * «tu plan no da para eso» (403) de «ese número se pasa» (400).
   *
   * Un perfil sin dueño no tiene plan que aplicar, igual que en el límite de
   * pases simultáneos: se le deja el modo único y nada más.
   */
  const limites = cuenta?.limites;
  if (limites && !limites.modosDePase.includes(modo)) throw new ModoNoPermitidoError(modo);
  if (!limites && modo !== "unico") throw new ModoNoPermitidoError(modo);

  const topeAccesos = limites?.maxAccesos ?? undefined;
  if (modo === "accesos" && topeAccesos !== undefined && (opts.maxAccesos ?? 0) > topeAccesos) {
    throw new ParametroDeModoError("maxAccesos", topeAccesos);
  }
  // La ventana la lleva SIEMPRE el modo `accesos`, con su valor por defecto si
  // no se pide otro: un pase sin plazo se quedaría abrible para siempre y la
  // purga no tocaría sus medios nunca.
  const ventanaMs =
    modo === "unico" ? null : (opts.ventanaMs ?? (modo === "accesos" ? VENTANA_POR_DEFECTO_MS : 0));
  const topeVentana = limites?.ventanaMaxMs ?? undefined;
  if (ventanaMs !== null && topeVentana !== undefined && ventanaMs > topeVentana) {
    throw new ParametroDeModoError("ventanaMs", topeVentana);
  }

  const token = generateToken();
  const tokenHash = await hashToken(token);
  const now = Date.now();

  // El plazo para la PRIMERA apertura. `unico` conserva exactamente el de
  // siempre —15 minutos por defecto, 24 h de tope—; los modos nuevos necesitan
  // días, porque acompañan una negociación y no un vistazo.
  const topePlazoMs =
    modo === "unico"
      ? PLAZO_UNICO_MAX_MS
      : (limites?.plazoPrimeraAperturaMaxMs ?? PLAZO_UNICO_MAX_MS);
  const plazoPedidoMs =
    opts.ttlSeconds !== undefined
      ? opts.ttlSeconds * 1000
      : modo === "unico"
        ? 900 * 1000
        : PLAZO_NUEVOS_POR_DEFECTO_MS;
  if (plazoPedidoMs > topePlazoMs) {
    throw new ParametroDeModoError("ttlSeconds", Math.floor(topePlazoMs / 1000));
  }
  const expiresAt = now + plazoPedidoMs;
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
      `INSERT INTO vistta.passes
         (id, token_hash, profile_id, status, created_at, expires_at,
          modo, max_accesos, ventana_ms, destinatario_ref, destinatario_nota, tema)
       VALUES ($1, $2, $3, 'pending', $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        id,
        tokenHash,
        opts.profileId,
        now,
        expiresAt,
        modo,
        modo === "accesos" ? (opts.maxAccesos ?? null) : null,
        ventanaMs,
        opts.destinatarioRef ?? null,
        opts.destinatarioNota ?? null,
        opts.tema ?? "oscuro",
      ]
    );
    if (medios.size > 0) {
      await tx.query(
        `INSERT INTO vistta.pass_media (pass_id, media_id)
         SELECT $1, unnest($2::text[])`,
        [id, [...medios.keys()]]
      );
    }
  });

  return { id, token, expiresAt, modo };
}

/**
 * Consumo ATÓMICO: el UPDATE condicional sigue siendo la única puerta.
 *
 * Decide y contabiliza A LA VEZ, en una sola sentencia. Un `SELECT` para mirar
 * el contador y un `UPDATE` después serían dos, y entre las dos caben otras
 * quince peticiones leyendo el mismo número: se colarían todas.
 *
 * Por qué basta el UPDATE, sin `FOR UPDATE`: en PostgreSQL el UPDATE toma el
 * bloqueo de la fila, las peticiones simultáneas se serializan sobre ella, y la
 * que despierta REEVALÚA su WHERE contra la fila ya cambiada. Así
 * `accesos_usados < max_accesos` se comprueba con el valor nuevo y pasan
 * exactamente las N que caben, ni una más. Hay un test de ráfaga de 16 que lo
 * comprueba, y está verificado por mutación: partiéndolo en dos sentencias, se
 * pone rojo.
 *
 * Denegar devuelve `null` SIEMPRE, y da igual el motivo —usado, agotado, fuera
 * de ventana, caducado o inexistente—: quien tiene el enlace no tiene por qué
 * averiguar en cuál de los cinco casos está.
 */
export async function consumePass(db: Db, token: string): Promise<PassView | null> {
  const tokenHash = await hashToken(token);
  const now = Date.now();

  const claimed = await db.one<{
    id: string;
    profile_id: string;
    destinatario_ref: string | null;
    tema: TemaDePase;
  }>(
    `UPDATE vistta.passes AS p SET
       accesos_usados      = p.accesos_usados + 1,
       -- La ventana se calcula AL ABRIR, no al crear: cuenta desde que el
       -- destinatario entra. El COALESCE hace que solo se fije la primera vez.
       primera_apertura_at = COALESCE(p.primera_apertura_at, $1),
       valido_hasta        = COALESCE(p.valido_hasta, $1 + p.ventana_ms),
       status              = CASE
                               WHEN p.modo = 'unico' THEN 'consumed'
                               WHEN p.modo = 'accesos'
                                    AND p.accesos_usados + 1 >= p.max_accesos THEN 'consumed'
                               ELSE p.status
                             END,
       consumed_at         = CASE
                               WHEN p.modo = 'unico' THEN $1
                               WHEN p.modo = 'accesos'
                                    AND p.accesos_usados + 1 >= p.max_accesos THEN $1
                               ELSE p.consumed_at
                             END
     WHERE p.token_hash = $2
       AND ${pasAbribleSql("p", "$1")}
     RETURNING p.id, p.profile_id, p.destinatario_ref, p.tema`,
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
    logo: string | null;
    data: unknown;
  }>(
    `SELECT p.id, p.display_name, p.brand_color, p.logo, p.data
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

  // El plan manda también aquí: sin métricas en el plan, el viewer no recibe
  // testigo y no puede medir nada.
  const cuenta = await cuentaDelPerfil(db, profile.id);

  return {
    passId: claimed.id,
    destinatarioRef: claimed.destinatario_ref,
    tema: claimed.tema,
    mideLectura: cuenta?.limites.metricasDeLectura ?? false,
    profileId: profile.id,
    displayName: profile.display_name,
    brandColor: profile.brand_color,
    logo: profile.logo,
    tagline: data.tagline,
    intro: data.intro ?? data.bio,
    sections: resolverSecciones(normalizeSections(data), medios),
  };
}

/** Un pase tal y como lo ve su dueño en el panel. Nunca lleva el token. */
export interface PaseListado {
  id: string;
  modo: ModoDePase;
  /** `abrible` = todavía se puede abrir; los otros dos ya no. */
  estado: "abrible" | "agotado" | "caducado";
  creadoEn: number;
  /** Plazo para la primera apertura. Deja de importar en cuanto se abre. */
  expiraEn: number;
  /** Hasta cuándo se puede seguir abriendo. Null mientras nadie lo haya abierto. */
  validoHasta: number | null;
  accesosUsados: number;
  maxAccesos: number | null;
  /**
   * Solo para el dueño del pase. La ruta que sirve esto ya comprueba que el
   * perfil es suyo; si algún día se expusiera en otro sitio, estos dos campos
   * son datos personales de un tercero y no pueden viajar.
   */
  destinatarioRef: string | null;
  destinatarioNota: string | null;
  tema: TemaDePase;
}

/**
 * Los pases de un perfil, para que su dueño vea en qué estado están.
 *
 * El estado lo calcula el SERVIDOR con el mismo predicado que el consumo, y no
 * el navegador: si el panel lo dedujera por su cuenta, tendríamos dos ideas de
 * «abrible» y una de las dos acabaría mintiéndole al cliente sobre un enlace
 * que ya mandó.
 *
 * El token no está y no puede estar: en la base solo vive su hash.
 */
export async function pasesDelPerfil(
  db: Db,
  profileId: string,
  ahora = Date.now()
): Promise<PaseListado[]> {
  const { rows } = await db.query<{
    id: string;
    modo: ModoDePase;
    status: string;
    created_at: number;
    expires_at: number;
    valido_hasta: number | null;
    accesos_usados: number;
    max_accesos: number | null;
    destinatario_ref: string | null;
    destinatario_nota: string | null;
    tema: TemaDePase;
    abrible: boolean;
  }>(
    `SELECT p.id, p.modo, p.status, p.created_at, p.expires_at, p.valido_hasta,
            p.accesos_usados, p.max_accesos, p.destinatario_ref, p.destinatario_nota, p.tema,
            (${pasAbribleSql("p", "$2")}) AS abrible
     FROM vistta.passes AS p
     WHERE p.profile_id = $1
     ORDER BY p.created_at DESC
     LIMIT 100`,
    [profileId, ahora]
  );

  return rows.map((r) => ({
    id: r.id,
    modo: r.modo,
    estado: r.abrible ? "abrible" : r.status === "consumed" ? "agotado" : "caducado",
    creadoEn: Number(r.created_at),
    expiraEn: Number(r.expires_at),
    validoHasta: r.valido_hasta === null ? null : Number(r.valido_hasta),
    accesosUsados: r.accesos_usados,
    maxAccesos: r.max_accesos,
    destinatarioRef: r.destinatario_ref,
    destinatarioNota: r.destinatario_nota,
    tema: r.tema,
  }));
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
    display: "display" in section ? section.display : undefined,
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
