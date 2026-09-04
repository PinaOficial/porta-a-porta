import { NextResponse } from "next/server";

import { listarCondominiosDoUsuario } from "@/lib/auth";
import { mapSupabaseAuthError } from "@/lib/auth/supabase-errors";
import { toAuthMeResponseDto } from "@/lib/dtos/auth";
import {
  badRequest,
  createErrorResponse,
  forbidden,
  validationError,
} from "@/lib/http/errors";
import { buscarUsuarioAplicacaoPorId } from "@/lib/repositories/auth.repository";
import { createClient as createSupabaseServerClient } from "@/lib/supabase/server";
import { loginSchema } from "@/lib/validations/auth";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => {
      throw badRequest("JSON inválido.");
    });

    const result = loginSchema.safeParse(body);

    if (!result.success) {
      throw validationError(result.error);
    }

    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.signInWithPassword(result.data);

    if (error) {
      throw mapSupabaseAuthError(error, "Não foi possível autenticar.");
    }

    if (!data.user) {
      throw forbidden("Não foi possível autenticar.");
    }

    const appUser = await buscarUsuarioAplicacaoPorId(data.user.id);

    if (!appUser) {
      await supabase.auth.signOut();
      throw forbidden("Conta indisponível.");
    }

    if (!appUser.ativo) {
      await supabase.auth.signOut();
      throw forbidden("Conta inativa.");
    }

    const condominios = await listarCondominiosDoUsuario(appUser);

    return NextResponse.json({
      data: toAuthMeResponseDto({
        user: appUser,
        condominios,
      }),
    });
  } catch (error) {
    return createErrorResponse(error, "Erro ao autenticar usuário.");
  }
}
