import { NextResponse } from "next/server";

import { listarCondominiosDoUsuario, requireAuth, requireSuperadmin } from "@/lib/auth";
import {
  toCondominioComRoleDto,
  toCondominioDto,
} from "@/lib/dtos/condominios";
import {
  badRequest,
  createErrorResponse,
  validationError,
} from "@/lib/http/errors";
import {
  criarCondominio,
  listarCondominios,
  listarCondominiosPorIds,
} from "@/lib/repositories/condominios.repository";
import { createCondominioSchema } from "@/lib/validations/condominios";
import { booleanQuerySchema } from "@/lib/validations/common";

export async function GET(request: Request) {
  try {
    const user = await requireAuth();
    const includeInactiveValue = new URL(request.url).searchParams.get("includeInactive");
    const includeInactiveResult = includeInactiveValue
      ? booleanQuerySchema.safeParse(includeInactiveValue)
      : undefined;

    if (includeInactiveResult && !includeInactiveResult.success) {
      throw validationError(includeInactiveResult.error);
    }

    const includeInactive = Boolean(includeInactiveResult?.data) && user.isSuperadmin;
    const condominiosAcessiveis = await listarCondominiosDoUsuario(user);
    const rolesByCondominiumId = new Map(
      condominiosAcessiveis.map((condominio) => [condominio.id, condominio.role]),
    );
    const condominios = user.isSuperadmin
      ? await listarCondominios(includeInactive)
      : await listarCondominiosPorIds([...rolesByCondominiumId.keys()]);

    return NextResponse.json({
      data: condominios.map((condominio) =>
        toCondominioComRoleDto(
          condominio,
          user.isSuperadmin
            ? "superadmin"
            : rolesByCondominiumId.get(condominio.id) ?? "member",
        ),
      ),
    });
  } catch (error) {
    return createErrorResponse(error, "Erro ao buscar condomínios.");
  }
}

export async function POST(request: Request) {
  try {
    await requireSuperadmin();

    const body = await request.json().catch(() => {
      throw badRequest("JSON inválido.");
    });

    const result = createCondominioSchema.safeParse(body);

    if (!result.success) {
      throw validationError(result.error);
    }

    const condominio = await criarCondominio(result.data);

    return NextResponse.json(
      {
        data: toCondominioDto(condominio),
      },
      {
        status: 201,
      },
    );
  } catch (error) {
    return createErrorResponse(error, "Erro ao criar condomínio.");
  }
}
