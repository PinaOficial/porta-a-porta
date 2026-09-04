import "server-only";

import { prisma } from "@/lib/db/prisma";

export function listarCondominios(includeInactive = false) {
  return prisma.condominios.findMany({
    where: {
      ...(includeInactive ? {} : { ativo: true }),
    },
    orderBy: {
      criado_em: "desc",
    },
  });
}

export function buscarCondominioPorId(id: string, includeInactive = false) {
  return prisma.condominios.findFirst({
    where: {
      id,
      ...(includeInactive ? {} : { ativo: true }),
    },
  });
}

export function listarCondominiosPorIds(ids: string[]) {
  if (ids.length === 0) {
    return Promise.resolve([]);
  }

  return prisma.condominios.findMany({
    where: {
      id: {
        in: ids,
      },
      ativo: true,
    },
    orderBy: {
      criado_em: "desc",
    },
  });
}

export function criarCondominio(data: {
  nome: string;
  descricao?: string | null;
  cep?: string | null;
  logradouro?: string | null;
  numero?: string | null;
  complemento?: string | null;
  bairro?: string | null;
  cidade?: string | null;
  uf?: string | null;
}) {
  return prisma.condominios.create({
    data,
  });
}

export function atualizarCondominio(
  id: string,
  data: {
    nome?: string;
    descricao?: string | null;
    cep?: string | null;
    logradouro?: string | null;
    numero?: string | null;
    complemento?: string | null;
    bairro?: string | null;
    cidade?: string | null;
    uf?: string | null;
  },
) {
  return prisma.condominios.update({
    where: {
      id,
    },

    data: {
      ...data,
      atualizado_em: new Date(),
    },
  });
}

export function desativarCondominio(id: string) {
  return prisma.condominios.update({
    where: {
      id,
    },
    data: {
      ativo: false,
      desativado_em: new Date(),
      atualizado_em: new Date(),
    },
  });
}
