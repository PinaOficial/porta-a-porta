import { NextResponse } from "next/server";
import { requireCondominiumAccess } from "@/lib/auth";
import { toPedidoDto } from "@/lib/dtos/marketplace";
import { badRequest, conflict, createErrorResponse, forbidden, notFound, validationError } from "@/lib/http/errors";
import { buscarVinculoAtivoDoCondomino } from "@/lib/repositories/membros.repository";
import { atualizarStatusPedido, buscarPedido } from "@/lib/repositories/pedidos.repository";
import { uuidSchema } from "@/lib/validations/common";
import { updatePedidoStatusSchema } from "@/lib/validations/pedidos";
type Context = { params: Promise<{ condominioId: string; pedidoId: string }> };
async function ids(context: Context) { const params = await context.params; const c = uuidSchema.safeParse(params.condominioId); const p = uuidSchema.safeParse(params.pedidoId); if (!c.success) throw validationError(c.error); if (!p.success) throw validationError(p.error); return { condominioId: c.data, pedidoId: p.data }; }
const transitions: Record<string, string[]> = {
  solicitado: ["aceito", "recusado"],
  aceito: ["concluido"],
  recusado: [],
  concluido: [],
};
export async function PATCH(request: Request, context: Context) { try { const { condominioId, pedidoId } = await ids(context); const auth = await requireCondominiumAccess(condominioId); const pedido = await buscarPedido(condominioId, pedidoId); if (!pedido) throw notFound(); const seller = Boolean(auth.user.condominoId && await buscarVinculoAtivoDoCondomino(condominioId, auth.user.condominoId, pedido.vendedor_vinculo_id)); if (auth.role === "member" && !seller) throw forbidden("Apenas o vendedor pode atualizar este pedido."); const body = await request.json().catch(() => { throw badRequest("JSON invalido."); }); const parsed = updatePedidoStatusSchema.safeParse(body); if (!parsed.success) throw validationError(parsed.error); if (!transitions[pedido.status].includes(parsed.data.status)) throw conflict("Transicao de status invalida."); const updated = await atualizarStatusPedido(condominioId, pedidoId, parsed.data.status); return NextResponse.json({ data: toPedidoDto(updated) }); } catch (error) { return createErrorResponse(error, "Erro ao atualizar status do pedido."); } }
