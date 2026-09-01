import { z } from "zod";

export const CreatePassSchema = z.object({
  profileId: z.string().min(1).max(128),
  ttlSeconds: z.number().int().positive().max(86400).optional(),
});
export type CreatePassInput = z.infer<typeof CreatePassSchema>;

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
export const SectionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("texto"), title: titulo, body: z.string().max(5000) }),
  z.object({ type: z.literal("galeria"), title: titulo, items: listaDeMedios(60) }),
  z.object({
    type: z.literal("proyecto"),
    title: titulo,
    body: z.string().max(5000).optional(),
    items: listaDeMedios(60),
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
