import { NextResponse } from "next/server";

import { listarCondominiosDoUsuario, requireAuth } from "@/lib/auth";
import { toAuthMeResponseDto } from "@/lib/dtos/auth";
import { createErrorResponse } from "@/lib/http/errors";

export async function GET() {
  try {
    const user = await requireAuth();
    const condominios = await listarCondominiosDoUsuario(user);

    return NextResponse.json({
      data: toAuthMeResponseDto({
        user,
        condominios,
      }),
    });
  } catch (error) {
    return createErrorResponse(error, "Erro ao buscar sessão atual.");
  }
}
