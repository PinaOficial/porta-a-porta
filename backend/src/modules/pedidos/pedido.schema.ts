import { z } from "zod";
import { status_pedido_enum } from "../../generated/prisma/client.js";

const inteiroPositivoQuery = (maximo: number) =>
  z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().min(1).max(maximo));

export const listarMeusPedidosQuerySchema = z.strictObject({
  pagina: inteiroPositivoQuery(2_147_483_647).default(1),
  limite: inteiroPositivoQuery(100).default(20),
  papel: z.enum(["compra", "venda"]).optional(),
  status: z.enum(status_pedido_enum).optional(),
}).refine(({ pagina, limite }) => (pagina - 1) * limite <= 2_147_483_647, {
  path: ["pagina"], message: "Página excede o intervalo permitido para paginação.",
});
export type ListarMeusPedidosQuery = z.infer<typeof listarMeusPedidosQuerySchema>;

export const criarPedidoBodySchema = z.strictObject({
  id_produto: z.uuid().transform((valor) => valor.toLowerCase()),
  quantidade: z.number().int().min(1).max(2_147_483_647),
  hora_combinada: z.iso.datetime({ offset: true }).transform((valor) => new Date(valor)),
});
export type CriarPedidoBody = z.infer<typeof criarPedidoBodySchema>;

export const pedidoParamsSchema = z.strictObject({
  id: z.uuid().transform((valor) => valor.toLowerCase()),
});
export type PedidoParams = z.infer<typeof pedidoParamsSchema>;

export const atualizarStatusPedidoBodySchema = z.strictObject({
  status: z.enum(["ACEITO", "RECUSADO", "CANCELADO", "CONCLUIDO"]),
  motivo: z.string().trim().max(255).optional(),
});
export type AtualizarStatusPedidoBody = z.infer<typeof atualizarStatusPedidoBodySchema>;
