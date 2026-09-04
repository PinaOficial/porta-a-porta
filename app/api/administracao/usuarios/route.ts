import { NextResponse } from "next/server";

import { requireAuth, requireCondominiumAdmin } from "@/lib/auth";
import { createErrorResponse, forbidden, validationError } from "@/lib/http/errors";
import {
  listarUsuariosDoCondominio,
  listarUsuariosGlobais,
} from "@/lib/repositories/administracao.repository";
import { listarConvitesAdminPendentes } from "@/lib/repositories/convites-admin.repository";
import { administracaoUsuariosQuerySchema } from "@/lib/validations/administracao";

export async function GET(request: Request) {
  try {
    const user = await requireAuth();
    const parsed = administracaoUsuariosQuerySchema.safeParse(
      Object.fromEntries(new URL(request.url).searchParams),
    );
    if (!parsed.success) throw validationError(parsed.error);

    const condominioId = parsed.data.condominioId;
    if (!user.isSuperadmin) {
      if (!condominioId) {
        throw forbidden("Selecione um condomínio administrado.");
      }
      await requireCondominiumAdmin(condominioId);
    } else if (condominioId) {
      await requireCondominiumAdmin(condominioId);
    }

    const includeInactive = Boolean(parsed.data.includeInactive);
    const usuarios = condominioId
      ? await listarUsuariosDoCondominio(condominioId, includeInactive)
      : await listarUsuariosGlobais(includeInactive);
    const convites = user.isSuperadmin
      ? await listarConvitesAdminPendentes(condominioId)
      : [];

    return NextResponse.json({
      data: {
        usuarios,
        convites: convites.map((convite) => ({
          id: convite.id,
          email: convite.email,
          condominio: convite.condominios,
          criadoEm: convite.criado_em.toISOString(),
        })),
      },
    });
  } catch (error) {
    return createErrorResponse(error, "Erro ao buscar usuários administrativos.");
  }
}
