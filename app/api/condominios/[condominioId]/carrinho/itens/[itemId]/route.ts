import { NextResponse } from "next/server";
import { requireActiveMembership } from "@/lib/auth";
import { toCarrinhoDto } from "@/lib/dtos/marketplace";
import { badRequest, conflict, createErrorResponse, notFound, validationError } from "@/lib/http/errors";
import { atualizarItemDoCarrinho, removerItemDoCarrinho } from "@/lib/repositories/carrinho.repository";
import { uuidSchema } from "@/lib/validations/common";
import { updateCarrinhoItemSchema } from "@/lib/validations/carrinho";
type Context = { params: Promise<{ condominioId: string; itemId: string }> };
async function ids(context: Context) { const params = await context.params; const c = uuidSchema.safeParse(params.condominioId); const i = uuidSchema.safeParse(params.itemId); if (!c.success) throw validationError(c.error); if (!i.success) throw validationError(i.error); return { condominioId: c.data, itemId: i.data }; }
export async function PATCH(request: Request, context: Context) { try { const { condominioId, itemId } = await ids(context); const auth = await requireActiveMembership(condominioId); const body = await request.json().catch(() => { throw badRequest("JSON invalido."); }); const parsed = updateCarrinhoItemSchema.safeParse(body); if (!parsed.success) throw validationError(parsed.error); const carrinho = await atualizarItemDoCarrinho({ condominioId, compradorVinculoId: auth.vinculoId, itemId, quantidade: parsed.data.quantidade }); if (!carrinho) throw conflict("Item indisponivel, sem estoque ou fora do seu carrinho."); return NextResponse.json({ data: toCarrinhoDto(carrinho) }); } catch (error) { return createErrorResponse(error, "Erro ao atualizar item do carrinho."); } }
export async function DELETE(_request: Request, context: Context) { try { const { condominioId, itemId } = await ids(context); const auth = await requireActiveMembership(condominioId); if (!await removerItemDoCarrinho({ condominioId, compradorVinculoId: auth.vinculoId, itemId })) throw notFound(); return new Response(null, { status: 204 }); } catch (error) { return createErrorResponse(error, "Erro ao remover item do carrinho."); } }
