import { NextResponse } from "next/server";

import { mapSupabaseAuthError } from "@/lib/auth/supabase-errors";
import { toAuthUserDto } from "@/lib/dtos/auth";
import {
  badRequest,
  createErrorResponse,
  forbidden,
  validationError,
} from "@/lib/http/errors";
import { buscarUsuarioAplicacaoPorId } from "@/lib/repositories/auth.repository";
import { createClient as createSupabaseServerClient } from "@/lib/supabase/server";
import { registerSchema } from "@/lib/validations/auth";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => {
      throw badRequest("JSON inválido.");
    });

    const result = registerSchema.safeParse(body);

    if (!result.success) {
      throw validationError(result.error);
    }

    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.signUp(result.data);

    if (error) {
      throw mapSupabaseAuthError(error, "Não foi possível concluir o cadastro.");
    }

    if (!data.user) {
      throw forbidden("Não foi possível concluir o cadastro.");
    }

    const appUser = await buscarUsuarioAplicacaoPorId(data.user.id);

    if (appUser?.ativo === false) {
      await supabase.auth.signOut();
      throw forbidden("Conta inativa.");
    }

    const safeUser = appUser
      ? toAuthUserDto(appUser)
      : {
          id: data.user.id,
          email: data.user.email ?? result.data.email,
          condominoId: null,
        };

    return NextResponse.json(
      {
        data: {
          user: safeUser,
          isSuperadmin: appUser?.isSuperadmin ?? false,
          condominios: [],
          sessionEstablished: Boolean(data.session),
          emailConfirmationRequired: !data.session,
        },
      },
      {
        status: 201,
      },
    );
  } catch (error) {
    return createErrorResponse(error, "Erro ao registrar usuário.");
  }
}
