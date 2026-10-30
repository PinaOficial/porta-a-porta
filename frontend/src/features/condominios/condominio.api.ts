import { apiFetch, type ListaPaginada, type Objeto } from "../../lib/api";
import type { Condominio, CondominioCriado, CondominioAdmin } from "./condominio.types";
import type { CriarCondominio } from "./condominio.schema";
export function criarCondominioAdmin(dados: CriarCondominio) {
  return apiFetch<Objeto<CondominioCriado>>("/admin/condominios", {
    method: "POST", json: { nome_residencial: dados.nome_residencial, cep: dados.cep, endereco: dados.endereco },
  });
}
export function listarCondominios(busca: string, pagina: number, signal?: AbortSignal) {
  const query = new URLSearchParams({ pagina: String(pagina), limite: "20" });
  if (busca.trim()) query.set("busca", busca.trim());
  return apiFetch<ListaPaginada<Condominio>>(`/condominios?${query}`, { signal });
}
export function listarCondominiosAdmin(busca: string, pagina: number, ativo: string, signal?: AbortSignal) {
  const query = new URLSearchParams({ pagina: String(pagina), limite: "20" });
  if (busca.trim()) query.set("busca", busca.trim());
  if (ativo === "true" || ativo === "false") query.set("ativo", ativo);
  return apiFetch<ListaPaginada<CondominioAdmin>>(`/admin/condominios?${query}`, { signal });
}
export function obterCondominioAdmin(id: string, signal?: AbortSignal) {
  return apiFetch<Objeto<CondominioAdmin>>(`/admin/condominios/${encodeURIComponent(id)}`, { signal });
}
export function editarCondominioAdmin(id: string, versao: string, dados: Partial<CriarCondominio>) {
  return apiFetch<Objeto<CondominioAdmin>>(`/admin/condominios/${encodeURIComponent(id)}`, { method: "PATCH", json: { ...dados, versao } });
}
export function alterarStatusCondominioAdmin(id: string, versao: string, ativo: boolean, motivo: string) {
  return apiFetch<Objeto<CondominioAdmin>>(`/admin/condominios/${encodeURIComponent(id)}/status`, { method: "PATCH", json: { versao, ativo, motivo } });
}
