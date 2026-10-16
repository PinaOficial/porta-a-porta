import { z } from "zod";
import { listarMeusPedidosQuerySchema } from "../pedidos/pedido.schema.js";

export const listarMensagensQuerySchema = z.strictObject({
  pagina: listarMeusPedidosQuerySchema.shape.pagina,
  limite: listarMeusPedidosQuerySchema.shape.limite.default(50),
}).refine(({ pagina, limite }) => (pagina - 1) * limite <= 2_147_483_647, {
  path: ["pagina"], message: "Página excede o intervalo permitido para paginação.",
});
export type ListarMensagensQuery = z.infer<typeof listarMensagensQuerySchema>;

export const criarMensagemBodySchema = z.strictObject({ conteudo: z.string().trim().min(1).max(1000) });
export type CriarMensagemBody = z.infer<typeof criarMensagemBodySchema>;
