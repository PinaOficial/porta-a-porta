import { NextResponse } from "next/server";
import { requireActiveMembership } from "@/lib/auth";
import { toCarrinhoDto } from "@/lib/dtos/marketplace";
import { createErrorResponse, notFound, validationError } from "@/lib/http/errors";
import { buscarCarrinhoAberto } from "@/lib/repositories/carrinho.repository";
import { uuidSchema } from "@/lib/validations/common";
type Context = { params: Promise<{ condominioId: string }> };
async function id(context: Context) { const parsed = uuidSchema.safeParse((await context.params).condominioId); if (!parsed.success) throw validationError(parsed.error); return parsed.data; }
export async function GET(_request: Request, context: Context) { try { const condominioId = await id(context); const auth = await requireActiveMembership(condominioId); const carrinho = await buscarCarrinhoAberto(condominioId, auth.vinculoId); if (!carrinho) throw notFound("Carrinho aberto nao encontrado."); return NextResponse.json({ data: toCarrinhoDto(carrinho) }); } catch (error) { return createErrorResponse(error, "Erro ao buscar carrinho."); } }
