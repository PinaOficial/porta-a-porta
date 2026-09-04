import { NextResponse } from "next/server";
import { requireActiveMembership } from "@/lib/auth";
import { toCarrinhoDto } from "@/lib/dtos/marketplace";
import { badRequest, conflict, createErrorResponse, validationError } from "@/lib/http/errors";
import { adicionarItemAoCarrinho } from "@/lib/repositories/carrinho.repository";
import { uuidSchema } from "@/lib/validations/common";
import { createCarrinhoItemSchema } from "@/lib/validations/carrinho";
type Context = { params: Promise<{ condominioId: string }> };
async function id(context: Context) { const parsed = uuidSchema.safeParse((await context.params).condominioId); if (!parsed.success) throw validationError(parsed.error); return parsed.data; }
export async function POST(request: Request, context: Context) { try { const condominioId = await id(context); const auth = await requireActiveMembership(condominioId); const body = await request.json().catch(() => { throw badRequest("JSON invalido."); }); const parsed = createCarrinhoItemSchema.safeParse(body); if (!parsed.success) throw validationError(parsed.error); const carrinho = await adicionarItemAoCarrinho({ condominioId, compradorVinculoId: auth.vinculoId, ...parsed.data }); if (!carrinho) throw conflict("Produto indisponivel, sem estoque ou pertencente ao comprador."); return NextResponse.json({ data: toCarrinhoDto(carrinho) }, { status: 201 }); } catch (error) { return createErrorResponse(error, "Erro ao adicionar item ao carrinho."); } }
