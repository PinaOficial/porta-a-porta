import { z } from "zod";

export const pedidosQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(["solicitado", "aceito", "recusado", "concluido"]).optional(),
  tipo: z.enum(["compras", "vendas"]).optional(),
});
export const updatePedidoStatusSchema = z.object({ status: z.enum(["aceito", "recusado", "concluido"]) }).strict();
