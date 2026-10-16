import { apiFetch, type ListaPaginada, type Objeto } from "../../lib/api";
import type { FiltrosAdministracao } from "./administracao.schema";
import type { StatusConta, VinculoAdministrativo, VinculoPendente, VinculoAprovado, VinculoRejeitado, VinculoSuspenso } from "./administracao.types";
function parametros(filtros: Omit<FiltrosAdministracao, "status"> & { status?: string }) {
  const query = new URLSearchParams({ pagina: String(filtros.pagina), limite: "20" });
  for (const campo of ["busca", "status", "id_condominio"] as const) if (filtros[campo]) query.set(campo, filtros[campo]);
  return query;
}
export const listarVinculosPendentes = (filtros: Omit<FiltrosAdministracao, "status">, signal?: AbortSignal) => apiFetch<ListaPaginada<VinculoPendente>>(`/admin/vinculos/pendentes?${parametros(filtros)}`, { signal });
export const listarVinculosAdmin = (filtros: FiltrosAdministracao, signal?: AbortSignal) => apiFetch<ListaPaginada<VinculoAdministrativo>>(`/admin/vinculos?${parametros(filtros)}`, { signal });
export const aprovarVinculo = (id: string) => apiFetch<Objeto<VinculoAprovado>>(`/admin/vinculos/${id}/aprovar`, { method: "PATCH" });
export const rejeitarVinculo = (id: string) => apiFetch<Objeto<VinculoRejeitado>>(`/admin/vinculos/${id}/rejeitar`, { method: "PATCH" });
export const suspenderVinculo = (id: string) => apiFetch<Objeto<VinculoSuspenso>>(`/admin/vinculos/${id}/suspender`, { method: "PATCH" });
export const alterarAdminVinculo = (id: string, admin_condominio: boolean) => apiFetch<Objeto<{ id_vinculo: string; admin_condominio: boolean; admin_atualizado_em: string | null }>>(`/admin/vinculos/${id}/admin`, { method: "PATCH", json: { admin_condominio } });
export const alterarStatusConta = (idUsuario: string, status_conta: StatusConta) => apiFetch<Objeto<{ id_usuario: string; status_conta: StatusConta }>>(`/admin/usuarios/${idUsuario}/status`, { method: "PATCH", json: { status_conta } });
