import { NextResponse } from "next/server";
import { requireCondominiumAccess } from "@/lib/auth";
import { toPedidoDto } from "@/lib/dtos/marketplace";
import { createErrorResponse, validationError } from "@/lib/http/errors";
import { listarPedidos } from "@/lib/repositories/pedidos.repository";
import { getPagination, uuidSchema } from "@/lib/validations/common";
import { pedidosQuerySchema } from "@/lib/validations/pedidos";
type Context = { params: Promise<{ condominioId: string }> };
async function id(context: Context) { const parsed = uuidSchema.safeParse((await context.params).condominioId); if (!parsed.success) throw validationError(parsed.error); return parsed.data; }
export async function GET(request: Request, context: Context) { try { const condominioId = await id(context); const auth = await requireCondominiumAccess(condominioId); const parsed = pedidosQuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams)); if (!parsed.success) throw validationError(parsed.error); const pagination = getPagination(parsed.data); const [pedidos, total] = await listarPedidos({ condominioId, vinculoId: auth.vinculoId, admin: auth.role !== "member", status: parsed.data.status, tipo: parsed.data.tipo, skip: pagination.skip, take: pagination.limit }); return NextResponse.json({ data: pedidos.map(toPedidoDto), page: pagination.page, limit: pagination.limit, total, totalPages: Math.ceil(total / pagination.limit) }); } catch (error) { return createErrorResponse(error, "Erro ao buscar pedidos."); } }
