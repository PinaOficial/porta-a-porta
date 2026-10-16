import { apiFetch, type ListaPaginada } from "../../lib/api";
import type { Condominio } from "./condominio.types";
export function listarCondominios(busca: string, pagina: number, signal?: AbortSignal) {
  const query = new URLSearchParams({ pagina: String(pagina), limite: "20" });
  if (busca.trim()) query.set("busca", busca.trim());
  return apiFetch<ListaPaginada<Condominio>>(`/condominios?${query}`, { signal });
}
