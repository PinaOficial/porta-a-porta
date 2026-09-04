import { NextResponse } from "next/server";
import { requireCondominiumAccess } from "@/lib/auth";
import { toPedidoDto } from "@/lib/dtos/marketplace";
import { createErrorResponse, methodNotAllowed, notFound, validationError } from "@/lib/http/errors";
import { buscarVinculoAtivoDoCondomino } from "@/lib/repositories/membros.repository";
import { buscarPedido } from "@/lib/repositories/pedidos.repository";
import { uuidSchema } from "@/lib/validations/common";
type Context = { params: Promise<{ condominioId: string; pedidoId: string }> };
async function ids(context: Context) { const params = await context.params; const c = uuidSchema.safeParse(params.condominioId); const p = uuidSchema.safeParse(params.pedidoId); if (!c.success) throw validationError(c.error); if (!p.success) throw validationError(p.error); return { condominioId: c.data, pedidoId: p.data }; }
export async function GET(_request: Request, context: Context) { try { const { condominioId, pedidoId } = await ids(context); const auth = await requireCondominiumAccess(condominioId); const pedido = await buscarPedido(condominioId, pedidoId); if (!pedido) throw notFound(); if (auth.role === "member") { const ownBuyer = pedido.comprador_vinculo_id === auth.vinculoId; const ownSeller = Boolean(auth.user.condominoId && await buscarVinculoAtivoDoCondomino(condominioId, auth.user.condominoId, pedido.vendedor_vinculo_id)); if (!ownBuyer && !ownSeller) throw notFound(); } return NextResponse.json({ data: toPedidoDto(pedido) }); } catch (error) { return createErrorResponse(error, "Erro ao buscar pedido."); } }
export async function DELETE(_request: Request, context: Context) { try { await ids(context); throw methodNotAllowed("Pedidos nao podem ser removidos."); } catch (error) { return createErrorResponse(error, "Erro ao remover pedido."); } }
