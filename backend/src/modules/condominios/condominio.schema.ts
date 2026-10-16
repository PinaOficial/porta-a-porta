import { z } from "zod";

const inteiroPositivoQuery = (maximo: number) =>
  z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().min(1).max(maximo));

export const listarCondominiosQuerySchema = z.strictObject({
  busca: z.string().trim().min(1).max(160).optional(),
  pagina: inteiroPositivoQuery(2_147_483_647).default(1),
  limite: inteiroPositivoQuery(50).default(20),
}).refine(({ pagina, limite }) => (pagina - 1) * limite <= 2_147_483_647, {
  path: ["pagina"],
  message: "Página excede o intervalo permitido para paginação.",
});

export type ListarCondominiosQuery = z.infer<typeof listarCondominiosQuerySchema>;
