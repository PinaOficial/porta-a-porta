import { apiFetch, type ListaPaginada, type Objeto } from "../../lib/api";
import type { Condominio, CondominioCriado } from "./condominio.types";
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
