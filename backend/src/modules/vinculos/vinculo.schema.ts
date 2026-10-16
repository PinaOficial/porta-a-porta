import { z } from "zod";
import { onboardingBodySchema } from "../usuarios/usuario.schema.js";

const inteiroPositivoQuery = (maximo: number) =>
  z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().min(1).max(maximo));

export const listarVinculosPendentesQuerySchema = z.strictObject({
  pagina: inteiroPositivoQuery(2_147_483_647).default(1),
  limite: inteiroPositivoQuery(100).default(20),
  busca: z.string().trim().max(160).transform((valor) => valor || undefined).optional(),
  id_condominio: z.uuid().transform((valor) => valor.toLowerCase()).optional(),
}).refine(({ pagina, limite }) => (pagina - 1) * limite <= 2_147_483_647, {
  path: ["pagina"],
  message: "Página excede o intervalo permitido para paginação.",
});

export type ListarVinculosPendentesQuery = z.infer<typeof listarVinculosPendentesQuerySchema>;

export const decisaoVinculoParamsSchema = z.strictObject({
  id: z.uuid().transform((valor) => valor.toLowerCase()),
});

export type DecisaoVinculoParams = z.infer<typeof decisaoVinculoParamsSchema>;

export const solicitarTransferenciaBodySchema = onboardingBodySchema.pick({ id_condominio: true, moradia: true })
  .extend({ id_condominio: z.uuid().transform((valor) => valor.toLowerCase()) });
export type SolicitarTransferenciaBody = z.infer<typeof solicitarTransferenciaBodySchema>;
