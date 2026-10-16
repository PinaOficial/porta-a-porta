import { apiFetch, type Objeto } from "../../lib/api";
import type { SituacaoResidencial } from "./vinculo.types";
import type { SolicitarTransferencia } from "./vinculo.schema";
import type { Vinculo } from "./vinculo.types";
export const consultarSituacaoResidencial = (signal?: AbortSignal) => apiFetch<Objeto<SituacaoResidencial>>("/vinculos/me", { signal });
export const solicitarTransferencia = (json: SolicitarTransferencia) => apiFetch<Objeto<{
  id_vinculo: string; id_condominio: string; moradia: string; status_vinculo: "PENDENTE";
  admin_condominio: false; data_solicitacao: Vinculo["data_solicitacao"];
}>>("/vinculos/transferencia", { method: "POST", json });
