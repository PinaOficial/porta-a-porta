import type { Vinculo } from "../vinculos/vinculo.types";
export type StatusVinculo = Vinculo["status_vinculo"];
interface BaseVinculoAdmin {
  id_vinculo: string; status_vinculo: StatusVinculo; moradia: string; data_solicitacao: string;
  condominio: { id_condominio: string; nome_residencial: string };
}
export interface VinculoPendente extends BaseVinculoAdmin {
  morador: { id_condomino: string; nome_completo: string };
}
export interface VinculoAdministrativo extends BaseVinculoAdmin {
  admin_condominio: boolean; data_inicio: string | null;
  morador: { id_usuario: string; nome_completo: string };
}
export type ItemAdministrativo = VinculoPendente | VinculoAdministrativo;
export type StatusConta = "ATIVA" | "SUSPENSA";
interface DecisaoBase extends BaseVinculoAdmin {
  admin_condominio: boolean; morador: VinculoPendente["morador"];
}
export type VinculoAprovado = Omit<DecisaoBase, "data_solicitacao"> & { data_aprovacao: string; data_inicio: string };
export type VinculoRejeitado = DecisaoBase & { data_aprovacao: null; data_inicio: null; data_fim: null };
export type VinculoSuspenso = DecisaoBase & { data_aprovacao: string | null; data_inicio: string | null; data_fim: string | null };
