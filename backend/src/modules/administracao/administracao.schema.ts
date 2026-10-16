import { z } from "zod";
import { status_vinculo_enum } from "../../generated/prisma/client.js";
import { listarVinculosPendentesQuerySchema } from "../vinculos/vinculo.schema.js";

export const listarVinculosQuerySchema = z.strictObject({
  ...listarVinculosPendentesQuerySchema.shape,
  status: z.enum(status_vinculo_enum).optional(),
}).refine(({ pagina, limite }) => (pagina - 1) * limite <= 2_147_483_647, {
  path: ["pagina"], message: "Página excede o intervalo permitido para paginação.",
});
export type ListarVinculosQuery = z.infer<typeof listarVinculosQuerySchema>;

export const atualizarAdminVinculoBodySchema = z.strictObject({ admin_condominio: z.boolean() });
export type AtualizarAdminVinculoBody = z.infer<typeof atualizarAdminVinculoBodySchema>;
