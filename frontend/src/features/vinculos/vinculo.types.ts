import type { Condominio } from "../condominios/condominio.types";
export interface Vinculo {
  id_vinculo: string;
  status_vinculo: "ATIVO" | "PENDENTE" | "REJEITADO" | "SUSPENSO" | "ENCERRADO";
  moradia: string;
  admin_condominio: boolean;
  data_solicitacao: string;
  data_aprovacao: string | null;
  data_inicio: string | null;
  data_fim: string | null;
  condominio: Condominio;
}
export interface SituacaoResidencial {
  onboarding_realizado: boolean;
  super_admin: boolean;
  vinculo_ativo: Vinculo | null;
  solicitacao_pendente: Vinculo | null;
  ultimo_vinculo: Vinculo | null;
}
