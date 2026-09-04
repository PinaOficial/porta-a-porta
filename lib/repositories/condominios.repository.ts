import "server-only";

import { prisma } from "@/lib/db/prisma";

export function listarCondominios() {
  return prisma.condominios.findMany({
    orderBy: {
      criado_em: "desc",
    },
  });
}

export function buscarCondominioPorId(id: string) {
  return prisma.condominios.findUnique({
    where: {
      id,
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

export function deletarCondominio(id: string) {
  return prisma.condominios.delete({
    where: {
      id,
    },
  });
}
