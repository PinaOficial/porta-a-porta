import { NextResponse } from "next/server";
import { requireActiveMembership } from "@/lib/auth";
import { toPedidoDto } from "@/lib/dtos/marketplace";
import { conflict, createErrorResponse, validationError } from "@/lib/http/errors";
import { checkoutCarrinho } from "@/lib/repositories/pedidos.repository";
import { uuidSchema } from "@/lib/validations/common";
type Context = { params: Promise<{ condominioId: string }> };
async function id(context: Context) { const parsed = uuidSchema.safeParse((await context.params).condominioId); if (!parsed.success) throw validationError(parsed.error); return parsed.data; }
export async function POST(_request: Request, context: Context) { try { const condominioId = await id(context); const auth = await requireActiveMembership(condominioId); const pedidos = await checkoutCarrinho(condominioId, auth.vinculoId); if (!pedidos || pedidos === "invalid") throw conflict("Carrinho vazio ou contem produtos indisponiveis."); return NextResponse.json({ data: pedidos.map(toPedidoDto) }, { status: 201 }); } catch (error) { if (error instanceof Error && error.message === "INSUFFICIENT_STOCK") return NextResponse.json({ error: "Estoque insuficiente." }, { status: 409 }); return createErrorResponse(error, "Erro ao finalizar compra."); } }
