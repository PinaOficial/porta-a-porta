import type { Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../../lib/prisma.js";
import type { CriarCondominioBody, ListarCondominiosQuery } from "./condominio.schema.js";

type FiltrosCondominios = Pick<ListarCondominiosQuery, "busca" | "limite"> & {
  deslocamento: number;
};

export function criarCondominio(tx: Prisma.TransactionClient, dados: CriarCondominioBody) {
  return tx.condominio.create({
    data: { nome_residencial: dados.nome_residencial, cep: dados.cep, endereco: dados.endereco },
    select: { id_condominio: true, nome_residencial: true, cep: true, endereco: true, ativo: true, created_at: true },
  });
}

export function buscarCondominioAtivoPorId(idCondominio: string) {
  return prisma.condominio.findFirst({
    where: { id_condominio: idCondominio, ativo: true },
    select: { id_condominio: true },
  });
}

export async function listarCondominiosAtivos(filtros: FiltrosCondominios) {
  const where: Prisma.condominioWhereInput = {
    ativo: true,
    ...(filtros.busca
      ? { nome_residencial: { contains: filtros.busca, mode: "insensitive" } }
      : {}),
  };

  // Página e contagem usam o mesmo snapshot para manter a paginação consistente.
  const [condominios, total] = await prisma.$transaction([
    prisma.condominio.findMany({
      where,
      select: {
        id_condominio: true,
        nome_residencial: true,
        cep: true,
        endereco: true,
      },
      orderBy: [{ nome_residencial: "asc" }, { id_condominio: "asc" }],
      skip: filtros.deslocamento,
      take: filtros.limite,
    }),
    prisma.condominio.count({ where }),
  ], { isolationLevel: "RepeatableRead" });

  return { condominios, total };
}

export function buscarCondominioParaTransferencia(tx: Prisma.TransactionClient, idCondominio: string) {
  return tx.condominio.findUnique({ where: { id_condominio: idCondominio }, select: { id_condominio: true, ativo: true } });
}
