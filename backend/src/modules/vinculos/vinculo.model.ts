import type { ListaCondominios } from "../condominios/condominio.model.js";
import type { VinculoDecididoConsultado, VinculoConsultado, VinculoPendenteConsultado } from "./vinculo.repository.js";
import type { criarSolicitacaoTransferencia } from "./vinculo.repository.js";

type SolicitacaoTransferencia = Awaited<ReturnType<typeof criarSolicitacaoTransferencia>>;
export interface ResultadoSolicitacaoTransferencia {
  dados: Omit<SolicitacaoTransferencia, "data_solicitacao"> & { data_solicitacao: string };
}

type DadosDecisaoVinculo = Pick<VinculoDecididoConsultado, "id_vinculo" | "status_vinculo" | "moradia" | "admin_condominio" | "condominio"> & {
  morador: VinculoDecididoConsultado["condomino"];
};

export interface ResultadoAprovacaoVinculo {
  dados: DadosDecisaoVinculo & {
    data_aprovacao: string;
    data_inicio: string;
  };
}

export interface ResultadoRejeicaoVinculo {
  dados: DadosDecisaoVinculo & {
    data_solicitacao: string;
    data_aprovacao: null;
    data_inicio: null;
    data_fim: null;
  };
}

export interface ResultadoSuspensaoVinculo {
  dados: DadosDecisaoVinculo & {
    data_solicitacao: string;
    data_aprovacao: string | null;
    data_inicio: string | null;
    data_fim: string | null;
  };
}

export interface ListaVinculosPendentes {
  dados: (Pick<VinculoPendenteConsultado, "id_vinculo" | "status_vinculo" | "moradia" | "condominio"> & {
    data_solicitacao: string;
    morador: VinculoPendenteConsultado["condomino"];
  })[];
  paginacao: ListaCondominios["paginacao"];
}

export type VinculoSituacaoResidencial = Omit<VinculoConsultado,
  "data_solicitacao" | "data_aprovacao" | "data_inicio" | "data_fim"
> & {
  data_solicitacao: string;
  data_aprovacao: string | null;
  data_inicio: string | null;
  data_fim: string | null;
};

export interface SituacaoResidencial {
  dados: {
    onboarding_realizado: boolean;
    super_admin: boolean;
    vinculo_ativo: VinculoSituacaoResidencial | null;
    solicitacao_pendente: VinculoSituacaoResidencial | null;
    ultimo_vinculo: VinculoSituacaoResidencial | null;
  };
}
