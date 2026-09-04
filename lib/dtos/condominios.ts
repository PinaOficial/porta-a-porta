import type { condominios } from "@/generated/prisma/client";

import type { EffectiveRole } from "@/lib/dtos/auth";

export type CondominioDto = {
  id: string;
  nome: string;
  descricao: string | null;
  cep: string | null;
  logradouro: string | null;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  cidade: string | null;
  uf: string | null;
  ativo: boolean;
  criadoEm: string;
  atualizadoEm: string;
  desativadoEm: string | null;
};

export type CondominioComRoleDto = CondominioDto & {
  role: EffectiveRole;
};

export function toCondominioDto(condominio: condominios): CondominioDto {
  return {
    id: condominio.id,
    nome: condominio.nome,
    descricao: condominio.descricao,
    cep: condominio.cep,
    logradouro: condominio.logradouro,
    numero: condominio.numero,
    complemento: condominio.complemento,
    bairro: condominio.bairro,
    cidade: condominio.cidade,
    uf: condominio.uf,
    ativo: condominio.ativo,
    criadoEm: condominio.criado_em.toISOString(),
    atualizadoEm: condominio.atualizado_em.toISOString(),
    desativadoEm: condominio.desativado_em?.toISOString() ?? null,
  };
}

export function toCondominioComRoleDto(
  condominio: condominios,
  role: EffectiveRole,
): CondominioComRoleDto {
  return {
    ...toCondominioDto(condominio),
    role,
  };
}
