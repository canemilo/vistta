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

export const MediaItemSchema = z.object({
  key: z.string().min(1).max(512),
  type: z.enum(["image", "video", "doc"]).default("image"),
  caption: z.string().max(280).optional(),
});
export type MediaItemInput = z.infer<typeof MediaItemSchema>;

const titulo = z.string().max(160).optional();

/**
 * Bloques de contenido. El cliente solo escribe textos y sube fotos: el orden y
 * el tipo de bloque son toda la estructura que necesita decidir; el diseño lo
 * monta el viewer.
 */
export const SectionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("texto"), title: titulo, body: z.string().max(5000) }),
  z.object({ type: z.literal("galeria"), title: titulo, items: z.array(MediaItemSchema).max(60) }),
  z.object({
    type: z.literal("proyecto"),
    title: titulo,
    body: z.string().max(5000).optional(),
    items: z.array(MediaItemSchema).max(60),
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
  media: z.array(MediaItemSchema).max(200).optional(),
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
