import { supabase } from "./supabase";
import { criarApi } from "./api.client";
export { ApiError } from "./api.client";
export type { Objeto, ListaPaginada, Paginacao } from "./api.client";

export const api = criarApi({
  baseUrl: import.meta.env.VITE_API_URL || "http://localhost:3000/api",
  obterSessao: async () => {
    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;
    return data.session;
  },
  renovarSessao: async () => {
    const { data, error } = await supabase.auth.refreshSession();
    return error ? null : data.session;
  },
});
export const apiFetch = api.requisitar;
