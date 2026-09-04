import { NextResponse } from "next/server";
import { requireCondominiumAdmin } from "@/lib/auth";
import { toMembroDto } from "@/lib/dtos/marketplace";
import { badRequest, conflict, createErrorResponse, notFound, validationError } from "@/lib/http/errors";
import { criarMembro, listarMembros } from "@/lib/repositories/membros.repository";
import { booleanQuerySchema, uuidSchema } from "@/lib/validations/common";
import { createMembroSchema } from "@/lib/validations/membros";
type Context = { params: Promise<{ condominioId: string }> };
async function id(context: Context) { const parsed = uuidSchema.safeParse((await context.params).condominioId); if (!parsed.success) throw validationError(parsed.error); return parsed.data; }
export async function GET(request: Request, context: Context) { try { const condominioId = await id(context); const auth = await requireCondominiumAdmin(condominioId); const raw = new URL(request.url).searchParams.get("includeInactive"); const parsed = raw ? booleanQuerySchema.safeParse(raw) : undefined; if (parsed && !parsed.success) throw validationError(parsed.error); return NextResponse.json({ data: (await listarMembros(condominioId, Boolean(parsed?.data) && auth.role !== "member")).map(toMembroDto) }); } catch (error) { return createErrorResponse(error, "Erro ao buscar membros."); } }
export async function POST(request: Request, context: Context) { try { const condominioId = await id(context); await requireCondominiumAdmin(condominioId); const body = await request.json().catch(() => { throw badRequest("JSON invalido."); }); const parsed = createMembroSchema.safeParse(body); if (!parsed.success) throw validationError(parsed.error); const membro = await criarMembro(condominioId, parsed.data); if (membro === "duplicate") throw conflict("Este vinculo ja existe."); if (!membro) throw notFound("Condomino ou apartamento nao encontrado no condominio."); return NextResponse.json({ data: toMembroDto(membro) }, { status: 201 }); } catch (error) { return createErrorResponse(error, "Erro ao criar vinculo."); } }
