import type { condominio } from "../../generated/prisma/client.js";

export type CondominioOnboarding = Pick<condominio,
  "id_condominio" | "nome_residencial" | "cep" | "endereco"
>;

export interface ListaCondominios {
  dados: CondominioOnboarding[];
  paginacao: {
    pagina: number;
    limite: number;
    total: number;
    total_paginas: number;
  };
}

export interface ResultadoCriacaoCondominio {
  dados: CondominioOnboarding & { ativo: boolean; created_at: string };
}
