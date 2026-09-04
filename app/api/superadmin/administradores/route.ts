import { NextResponse } from "next/server";
import { requireSuperadmin } from "@/lib/auth";
import { badRequest, conflict, createErrorResponse, notFound, validationError } from "@/lib/http/errors";
import {
  criarConviteAdmin,
  listarConvitesAdminPendentes,
} from "@/lib/repositories/convites-admin.repository";
import { createConviteAdminSchema } from "@/lib/validations/convites-admin";

export async function GET() {
  try {
    await requireSuperadmin();
    const convites = await listarConvitesAdminPendentes();
    return NextResponse.json({
      data: convites.map((convite) => ({
        id: convite.id,
        email: convite.email,
        condominio: convite.condominios,
        criadoEm: convite.criado_em.toISOString(),
      })),
    });
  } catch (error) {
    return createErrorResponse(error, "Erro ao buscar autorizações administrativas.");
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireSuperadmin();
    const body = await request.json().catch(() => { throw badRequest("JSON inválido."); });
    const parsed = createConviteAdminSchema.safeParse(body);
    if (!parsed.success) throw validationError(parsed.error);
    const convite = await criarConviteAdmin({ ...parsed.data, criadoPorUsuarioId: user.id });
    if (!convite) throw notFound("Condomínio não encontrado.");
    if (convite === "already-admin") throw conflict("ADMIN_ALREADY_EXISTS");
    if (convite === "pending") throw conflict("ADMIN_INVITE_ALREADY_PENDING");
    return NextResponse.json({ data: { id: convite.id, email: convite.email, condominioId: convite.condominio_id } }, { status: 201 });
  } catch (error) { return createErrorResponse(error, "Erro ao conceder acesso administrativo."); }
}
