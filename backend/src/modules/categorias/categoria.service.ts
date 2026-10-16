import { autorizarAcessoVitrine } from "../../lib/autorizacao-vitrine.js";
import type { ContextoAutenticado } from "../../types/auth.js";
import type { CategoriasVitrine } from "./categoria.model.js";
import { listarCategoriasAtivas } from "./categoria.repository.js";

export async function listarCategoriasDaVitrine(auth: ContextoAutenticado | undefined): Promise<CategoriasVitrine> {
  autorizarAcessoVitrine(auth);
  return { dados: await listarCategoriasAtivas() };
}
