import { ErroDominio } from "../../lib/erro-dominio.js";
import type { ContextoAutenticado } from "../../types/auth.js";
import type { ListaCondominios } from "./condominio.model.js";
import { listarCondominiosAtivos } from "./condominio.repository.js";
import type { ListarCondominiosQuery } from "./condominio.schema.js";

export async function listarCondominiosDisponiveis(
  auth: ContextoAutenticado | undefined,
  filtros: ListarCondominiosQuery,
): Promise<ListaCondominios> {
  if (!auth) {
    throw new ErroDominio("UNAUTHENTICATED", 401, "Autenticação necessária.");
  }

  const { condominios, total } = await listarCondominiosAtivos({
    busca: filtros.busca,
    limite: filtros.limite,
    deslocamento: (filtros.pagina - 1) * filtros.limite,
  });

  return {
    dados: condominios,
    paginacao: {
      pagina: filtros.pagina,
      limite: filtros.limite,
      total,
      total_paginas: Math.ceil(total / filtros.limite),
    },
  };
}
