import { z } from "zod";

export const CreatePassSchema = z.object({
  profileId: z.string().min(1).max(128),
  ttlSeconds: z.number().int().positive().max(86400).optional(),
});
export type CreatePassInput = z.infer<typeof CreatePassSchema>;

export const PanelLoginSchema = z.object({
  pin: z.string().min(4).max(64),
});

export const MediaItemSchema = z.object({
  key: z.string().min(1).max(512),
  type: z.enum(["image", "video", "doc"]),
  caption: z.string().max(280).optional(),
});

/** Contenido del perfil (columna profiles.data). Todo opcional salvo la forma. */
export const ProfileDataSchema = z
  .object({
    bio: z.string().max(2000).optional(),
    media: z.array(MediaItemSchema).max(200).optional(),
  })
  .passthrough();
export type ProfileData = z.infer<typeof ProfileDataSchema>;
