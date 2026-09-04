import type { AccessibleCondominioDto } from "@/lib/dtos/auth";
import type { AppUserRecord } from "@/lib/repositories/auth.repository";
import type { buscarPerfil } from "@/lib/repositories/perfil.repository";

type PerfilRecord = NonNullable<Awaited<ReturnType<typeof buscarPerfil>>>;

export type PerfilDto = {
  conta: {
    id: string;
    email: string | null;
    ativo: boolean;
    papel: "superadmin" | "admin" | "member";
    condominiosAdministrados: Array<{ id: string; nome: string }>;
  };
  morador: null | {
    id: string;
    nome: string;
    dataNascimento: string;
    vinculos: Array<{
      vinculoId: string;
      tipoVinculo: string;
      condominio: { id: string; nome: string };
      apartamento: { id: string; numero: string; bloco: string };
    }>;
  };
};

export function toPerfilDto(params: {
  user: AppUserRecord;
  condominios: AccessibleCondominioDto[];
  perfil: PerfilRecord | null;
}): PerfilDto {
  const papel = params.user.isSuperadmin
    ? "superadmin"
    : params.condominios.some((condominio) => condominio.role === "admin")
      ? "admin"
      : "member";

  return {
    conta: {
      id: params.user.id,
      email: params.user.email,
      ativo: params.user.ativo,
      papel,
      condominiosAdministrados: params.condominios
        .filter((condominio) => condominio.role === "admin")
        .map(({ id, nome }) => ({ id, nome })),
    },
    morador: params.perfil
      ? {
          id: params.perfil.id,
          nome: params.perfil.nome,
          dataNascimento: params.perfil.data_nascimento
            .toISOString()
            .slice(0, 10),
          vinculos: params.perfil.condomino_apartamentos.map((vinculo) => ({
            vinculoId: vinculo.id,
            tipoVinculo: vinculo.tipo_vinculo,
            condominio: {
              id: vinculo.apartamentos.condominio_id,
              nome: vinculo.apartamentos.condominios.nome,
            },
            apartamento: {
              id: vinculo.apartamentos.id,
              numero: vinculo.apartamentos.numero,
              bloco: vinculo.apartamentos.bloco,
            },
          })),
        }
      : null,
  };
}
