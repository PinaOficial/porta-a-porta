export type AdministracaoVinculoDto = {
  vinculoId: string;
  condominio: { id: string; nome: string };
  apartamento: { id: string; bloco: string; numero: string };
  tipoVinculo: "proprietario" | "inquilino";
  ativo: boolean;
};

export type AdministracaoAdminDto = {
  administradorId: string;
  condominio: { id: string; nome: string };
  ativo: boolean;
};

export type AdministracaoUsuarioDto = {
  key: string;
  usuarioId: string | null;
  condominoId: string | null;
  nome: string;
  email: string | null;
  contaAtiva: boolean | null;
  isSuperadmin: boolean;
  vinculos: AdministracaoVinculoDto[];
  administracoes: AdministracaoAdminDto[];
};

export type ConviteAdminDto = {
  id: string;
  email: string;
  condominio: { id: string; nome: string };
  criadoEm: string;
};
