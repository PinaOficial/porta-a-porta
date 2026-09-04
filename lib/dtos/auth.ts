import type { AppUserRecord } from "@/lib/repositories/auth.repository";

export type EffectiveRole = "member" | "admin" | "superadmin";

export type AuthUserDto = {
  id: string;
  email: string | null;
  condominoId: string | null;
  ativo: boolean;
};

export type AccessibleCondominioDto = {
  id: string;
  nome: string;
  cidade: string | null;
  uf: string | null;
  role: EffectiveRole;
  hasMembership: boolean;
};

export type AuthMeResponseDto = {
  user: AuthUserDto;
  isSuperadmin: boolean;
  condominios: AccessibleCondominioDto[];
};

export type AuthRegisterResponseDto = {
  user: AuthUserDto;
  isSuperadmin: boolean;
  condominios: AccessibleCondominioDto[];
  sessionEstablished: boolean;
  emailConfirmationRequired: boolean;
};

export function toAuthUserDto(user: AppUserRecord): AuthUserDto {
  return {
    id: user.id,
    email: user.email,
    condominoId: user.condominoId,
    ativo: user.ativo,
  };
}

export function toAuthMeResponseDto(params: {
  user: AppUserRecord;
  condominios: AccessibleCondominioDto[];
}): AuthMeResponseDto {
  return {
    user: toAuthUserDto(params.user),
    isSuperadmin: params.user.isSuperadmin,
    condominios: params.condominios,
  };
}
