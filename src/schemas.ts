import { z } from "zod";
import { ACCESOS_MINIMOS, VENTANA_MINIMA_MS } from "./lib/planes";
import { EVENTOS_POR_ENVIO, MS_VISIBLE_MAXIMO } from "./lib/eventos";

export const CreatePassSchema = z
  .object({
    profileId: z.string().min(1).max(128),
    /**
     * Plazo para la PRIMERA apertura. El tope real lo pone el plan: aquí solo
     * se corta lo absurdo. `unico` se queda en 24 h como siempre.
     */
    ttlSeconds: z
      .number()
      .int()
      .positive()
      .max(7 * 24 * 3600)
      .optional(),
    modo: z.enum(["unico", "accesos", "ventana"]).default("unico"),
    /**
     * Con qué aspecto se enseña. Lo elige quien manda el enlace, no quien lo
     * abre: es una decisión sobre el trabajo que se está enseñando.
     */
    tema: z.enum(["oscuro", "claro"]).default("oscuro"),
    /**
     * A quién se le enseña. Lo escribe el cliente y va DENTRO de la imagen.
     *
     * Es un dato personal de un tercero: el tope de longitud está también en la
     * base, y lo que se dibuja se trunca aparte (`REFERENCIA_MAXIMA`), porque
     * caber en la imagen y ser aceptable son dos cosas distintas.
     */
    destinatarioRef: z.string().trim().min(1).max(120).optional(),
    /** Nota privada del cliente para reconocer el pase. No se pinta nunca. */
    destinatarioNota: z.string().trim().min(1).max(120).optional(),
    maxAccesos: z.number().int().min(ACCESOS_MINIMOS).max(100).optional(),
    ventanaMs: z.number().int().positive().optional(),
  })
  /*
   * Las combinaciones incoherentes se rechazan con 400 aquí, antes de tocar la
   * base. Los TOPES por plan no: esos necesitan saber de quién es el perfil, y
   * se comprueban en `createPass` para poder distinguir «no puedes» (403) de
   * «ese número no vale» (400).
   */
  .superRefine((v, ctx) => {
    const exigir = (campo: "maxAccesos" | "ventanaMs", mensaje: string) => {
      if (v[campo] === undefined) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: [campo], message: mensaje });
      }
    };
    const prohibir = (campo: "maxAccesos" | "ventanaMs", mensaje: string) => {
      if (v[campo] !== undefined) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: [campo], message: mensaje });
      }
    };

    if (v.modo === "unico") {
      prohibir("maxAccesos", "el modo `unico` no lleva número de accesos");
      prohibir("ventanaMs", "el modo `unico` no lleva ventana");
    }
    if (v.modo === "accesos") {
      exigir("maxAccesos", "el modo `accesos` necesita `maxAccesos`");
    }
    if (v.modo === "ventana") {
      exigir("ventanaMs", "el modo `ventana` necesita `ventanaMs`");
      prohibir("maxAccesos", "el modo `ventana` no lleva número de accesos");
    }
    if (v.ventanaMs !== undefined && v.ventanaMs < VENTANA_MINIMA_MS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["ventanaMs"],
        message: "la ventana mínima es de una hora",
      });
    }
  });
export type CreatePassInput = z.infer<typeof CreatePassSchema>;

/**
 * Lo que manda el viewer con la telemetría de una lectura.
 *
 * Todo con tope, porque el que envía es un navegador que puede estar
 * manipulado: sin esto, un cliente listo podría inyectar «cuatro horas en la
 * sección Planos» y el panel se lo enseñaría a su dueño como si fuera verdad.
 */
export const EventosSchema = z.object({
  /** Testigo firmado que se emitió al abrir el pase. No es el token del pase. */
  testigo: z.string().min(1).max(400),
  eventos: z
    .array(
      z.object({
        tipo: z.enum(["apertura", "seccion", "medio", "cierre"]),
        seccionIdx: z.number().int().min(0).max(100).optional(),
        mediaId: z.string().min(1).max(128).optional(),
        msVisible: z.number().int().min(0).max(MS_VISIBLE_MAXIMO).optional(),
      })
    )
    .max(EVENTOS_POR_ENVIO),
});

export const PanelLoginSchema = z.object({
  userId: z.string().min(1).max(64),
  password: z.string().min(8).max(200),
});

/**
 * Referencia a un medio DENTRO del contenido del perfil.
 *
 * Guarda un id, no una clave de almacenamiento, y la diferencia no es de estilo:
 * con claves, un usuario podía escribir en su perfil la clave de otro y el
 * backend la firmaba sin más (el IDOR del §3 del HANDOFF). Con ids, cada
 * referencia se contrasta contra `vistta.media`, donde consta de quién es.
 *
 * El tipo tampoco viaja aquí: sale de `media.kind`, que se decidió mirando los
 * bytes reales. Si lo declarase el cliente, un vídeo podría hacerse pasar por
 * imagen y entrar por el camino de Sharp.
 */
/**
 * Cambio de contraseña por el propio cliente.
 *
 * El mínimo de 10 es más alto que el del login (8) a propósito: al entrar hay
 * que aceptar contraseñas viejas que ya existen, pero al poner una nueva no hay
 * ninguna razón para admitir una peor de la que se puede exigir hoy.
 */
export const CambiarPasswordSchema = z.object({
  actual: z.string().min(1).max(200),
  nueva: z.string().min(10).max(200),
});

/**
 * Confirmación del borrado de un perfil.
 *
 * Se teclea el NOMBRE del perfil, igual que el borrado de cuenta hace teclear
 * el identificador. Un `DELETE` a secas se manda sin querer; escribir el nombre
 * de lo que se va a destruir, no.
 */
/** Solo el identificador: no hay nada más que pedirle a quien no puede entrar. */
export const ClaveOlvidadaSchema = z.object({
  userId: z.string().min(1).max(64),
});

export const BorrarPerfilSchema = z.object({
  confirmacion: z.string().min(1).max(120),
});

export const MediaItemSchema = z.object({
  mediaId: z.string().uuid(),
  caption: z.string().max(280).optional(),
});
export type MediaItemInput = z.infer<typeof MediaItemSchema>;

/**
 * Una lista de medios, tolerante con lo que no reconoce.
 *
 * Los perfiles guardados antes del bloque D llevan `{ key: … }`, que ya no
 * significa nada: esas entradas se caen y el resto del contenido sobrevive. La
 * alternativa —fallar la validación entera— dejaría el perfil en blanco al
 * abrirlo, que es mucho peor que perder unas fotos que de todas formas no se
 * pueden servir.
 */
const listaDeMedios = (max: number) =>
  z.preprocess(
    (v) =>
      Array.isArray(v) ? v.filter((i) => typeof i === "object" && i !== null && "mediaId" in i) : v,
    z.array(MediaItemSchema).max(max)
  );

const titulo = z.string().max(160).optional();

/**
 * Bloques de contenido. El cliente solo escribe textos y sube fotos: el orden y
 * el tipo de bloque son toda la estructura que necesita decidir; el diseño lo
 * monta el viewer.
 */
/**
 * Cómo se presentan las fotos de un bloque.
 *
 *   cuadricula — filas ordenadas, todas las celdas iguales. Es el que da
 *                sensación de orden y el que se usa si no se dice nada.
 *   carrusel   — una tira que se desliza en horizontal, sin recortar nada.
 *
 * Es OPCIONAL, y por eso el contenido que ya existe sigue siendo válido: al
 * leerlo, un bloque sin este campo se presenta en cuadrícula. Si fuera
 * obligatorio, guardar un perfil viejo empezaría a fallar.
 */
export const PresentacionSchema = z.enum(["cuadricula", "carrusel"]);
export type Presentacion = z.infer<typeof PresentacionSchema>;

export const SectionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("texto"), title: titulo, body: z.string().max(5000) }),
  z.object({
    type: z.literal("galeria"),
    title: titulo,
    items: listaDeMedios(60),
    display: PresentacionSchema.optional(),
  }),
  z.object({
    type: z.literal("proyecto"),
    title: titulo,
    body: z.string().max(5000).optional(),
    items: listaDeMedios(60),
    display: PresentacionSchema.optional(),
  }),
]);
export type Section = z.infer<typeof SectionSchema>;

/** Contenido del perfil (columna profiles.data). */
export const ProfileDataSchema = z.object({
  tagline: z.string().max(200).optional(),
  intro: z.string().max(2000).optional(),
  sections: z.array(SectionSchema).max(30).default([]),
  // Formato antiguo: se sigue aceptando y se normaliza a secciones al abrir.
  bio: z.string().max(2000).optional(),
  media: listaDeMedios(200).optional(),
});
export type ProfileData = z.infer<typeof ProfileDataSchema>;

export const UpdateProfileSchema = z.object({
  displayName: z.string().min(1).max(120).optional(),
  brandColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .nullable()
    .optional(),
  data: ProfileDataSchema,
});

/** Crear un perfil. El id lo genera el servidor: no lo elige el cliente. */
export const CreateProfileSchema = z.object({
  displayName: z.string().min(1).max(120),
  brandColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
});

/** Reserva de subida: lo que el cliente declara ANTES de mandar un solo byte. */
export const PresignSchema = z.object({
  profileId: z.string().min(1).max(128),
  kind: z.enum(["image", "video", "doc"]),
  /** Tamaño declarado. No se cree; se usa para reservar y se contrasta luego. */
  bytes: z.number().int().positive(),
});

/** Todos los ids de medio que aparecen en un contenido. */
export function idsDeMedios(data: ProfileData): string[] {
  const ids = data.sections.flatMap((s) => ("items" in s ? s.items.map((i) => i.mediaId) : []));
  return [...new Set([...ids, ...(data.media ?? []).map((i) => i.mediaId)])];
}
