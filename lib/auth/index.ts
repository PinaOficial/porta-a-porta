import "server-only";

import { createClient as createSupabaseServerClient } from "@/lib/supabase/server";
import {
  buscarUsuarioAplicacaoPorId,
  listarCondominiosAcessiveisPorUsuario,
  resolverPapelPorCondominio,
  type AppUserRecord,
} from "@/lib/repositories/auth.repository";
import {
  forbidden,
  notFound,
  unauthorized,
} from "@/lib/http/errors";
import type { AccessibleCondominioDto, EffectiveRole } from "@/lib/dtos/auth";

export type { EffectiveRole } from "@/lib/dtos/auth";

export type AuthenticatedUser = AppUserRecord;

export type AuthContext = {
  user: AuthenticatedUser;
  condominioId: string | null;
  role: EffectiveRole | null;
  vinculoId: string | null;
};

export type AuthorizedCondominiumContext = AuthContext & {
  condominioId: string;
  role: EffectiveRole;
};

export type MembershipCondominiumContext = AuthorizedCondominiumContext & {
  vinculoId: string;
};

export async function requireAuth() {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getClaims();

  if (error) {
    throw unauthorized();
  }

  const userId = data?.claims?.sub;

  if (typeof userId !== "string" || userId.length === 0) {
    throw unauthorized();
  }

  const user = await buscarUsuarioAplicacaoPorId(userId);

  if (!user) {
    throw unauthorized();
  }

  if (!user.ativo) {
    throw forbidden("Conta inativa.");
  }

  return user;
}

export async function getAuthContext(condominioId?: string): Promise<AuthContext> {
  const user = await requireAuth();

  if (!condominioId) {
    return {
      user,
      condominioId: null,
      role: null,
      vinculoId: null,
    };
  }

  const resolution = await resolverPapelPorCondominio(user, condominioId);

  if (!resolution) {
    return {
      user,
      condominioId,
      role: null,
      vinculoId: null,
    };
  }

  return {
    user,
    condominioId,
    role: resolution.role,
    vinculoId: resolution.vinculoId,
  };
}

export async function requireCondominiumAccess(
  condominioId: string,
): Promise<AuthorizedCondominiumContext> {
  const context = await getAuthContext(condominioId);

  if (!context.role) {
    throw notFound("Condomínio não encontrado.");
  }

  return {
    ...context,
    condominioId,
    role: context.role,
  };
}

export async function requireCondominiumAdmin(
  condominioId: string,
): Promise<AuthorizedCondominiumContext> {
  const context = await requireCondominiumAccess(condominioId);

  if (context.role === "member") {
    throw forbidden("Permissão administrativa insuficiente.");
  }

  return context;
}

export async function requireSuperadmin() {
  const user = await requireAuth();

  if (!user.isSuperadmin) {
    throw forbidden("Apenas superadmins podem executar esta operação.");
  }

  return user;
}

export async function requireActiveMembership(
  condominioId: string,
): Promise<MembershipCondominiumContext> {
  const context = await requireCondominiumAccess(condominioId);

  if (!context.vinculoId) {
    throw forbidden(
      "É necessário possuir vínculo ativo de morador neste condomínio.",
    );
  }

  return {
    ...context,
    vinculoId: context.vinculoId,
  };
}

export async function requireResourceOwnerOrAdmin(params: {
  condominioId: string;
  ownerUserId: string | null | undefined;
}) {
  const context = await requireCondominiumAccess(params.condominioId);

  if (params.ownerUserId === context.user.id) {
    return context;
  }

  if (context.role === "admin" || context.role === "superadmin") {
    return context;
  }

  throw forbidden("Você não pode modificar este recurso.");
}

export async function listarCondominiosDoUsuario(
  user: AppUserRecord,
): Promise<AccessibleCondominioDto[]> {
  return listarCondominiosAcessiveisPorUsuario(user);
}
