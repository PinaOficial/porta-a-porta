import type { ContextoAutenticado } from "../types/auth.js";
import { ErroDominio } from "./erro-dominio.js";

export function obterVinculoAtivo(auth: ContextoAutenticado | undefined) {
  if (!auth) {
    throw new ErroDominio("UNAUTHENTICATED", 401, "Autenticação necessária.");
  }
  if (!auth.vinculo_ativo) {
    throw new ErroDominio("MEMBERSHIP_REQUIRED", 403, "Um vínculo ativo é necessário para acessar a vitrine.");
  }
  return auth.vinculo_ativo;
}

export function autorizarAcessoVitrine(auth: ContextoAutenticado | undefined) {
  if (auth?.super_admin) return { super_admin: true as const };
  return { super_admin: false as const, vinculo_ativo: obterVinculoAtivo(auth) };
}
