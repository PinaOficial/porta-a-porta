import { z } from "zod";

import { uuidSchema } from "@/lib/validations/common";

export const administracaoUsuariosQuerySchema = z
  .object({
    condominioId: uuidSchema.optional(),
    includeInactive: z
      .enum(["true", "false"])
      .transform((value) => value === "true")
      .optional(),
  })
  .strict();

export const usuarioIdSchema = uuidSchema;
export const administradorIdSchema = uuidSchema;
export const conviteAdminIdSchema = uuidSchema;
