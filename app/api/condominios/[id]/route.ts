import { NextResponse } from "next/server";

import {
  requireCondominiumAccess,
  requireSuperadmin,
} from "@/lib/auth";
import { toCondominioComRoleDto, toCondominioDto } from "@/lib/dtos/condominios";
import {
  badRequest,
  createErrorResponse,
  notFound,
  validationError,
} from "@/lib/http/errors";
import {
  atualizarCondominio,
  buscarCondominioPorId,
  desativarCondominio,
} from "@/lib/repositories/condominios.repository";
import {
  condominioIdSchema,
  updateCondominioSchema,
} from "@/lib/validations/condominios";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

async function parseCondominioId(context: RouteContext) {
  const { id } = await context.params;
  const result = condominioIdSchema.safeParse(id);

  if (!result.success) {
    throw validationError(result.error);
  }

  return result.data;
}

export async function GET(_request: Request, context: RouteContext) {
  try {
    const condominioId = await parseCondominioId(context);
    const authContext = await requireCondominiumAccess(condominioId);
    const condominio = await buscarCondominioPorId(condominioId);

    if (!condominio) {
      throw notFound("Condomínio não encontrado.");
    }

    return NextResponse.json({
      data: toCondominioComRoleDto(condominio, authContext.role),
    });
  } catch (error) {
    return createErrorResponse(error, "Erro ao buscar condomínio.");
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    await requireSuperadmin();

    const condominioId = await parseCondominioId(context);
    const existingCondominio = await buscarCondominioPorId(condominioId);

    if (!existingCondominio) {
      throw notFound("Condomínio não encontrado.");
    }

    const body = await request.json().catch(() => {
      throw badRequest("JSON inválido.");
    });

    const result = updateCondominioSchema.safeParse(body);

    if (!result.success) {
      throw validationError(result.error);
    }

    const condominio = await atualizarCondominio(condominioId, result.data);

    return NextResponse.json({
      data: toCondominioDto(condominio),
    });
  } catch (error) {
    return createErrorResponse(error, "Erro ao atualizar condomínio.");
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    await requireSuperadmin();

    const condominioId = await parseCondominioId(context);
    const existingCondominio = await buscarCondominioPorId(condominioId);

    if (!existingCondominio) {
      throw notFound("Condomínio não encontrado.");
    }

    await desativarCondominio(condominioId);

    return new Response(null, {
      status: 204,
    });
  } catch (error) {
    return createErrorResponse(error, "Erro ao desativar condomínio.");
  }
}
