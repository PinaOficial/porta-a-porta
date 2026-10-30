import { Prisma } from "../../generated/prisma/client.js";
import type { condominio } from "../../generated/prisma/client.js";
import type { EditarCondominioBody, ListarCondominiosAdminQuery } from "./condominio.schema.js";

export type CondominioVersionado = Pick<condominio, "id_condominio" | "nome_residencial" | "cep" | "endereco" | "ativo" | "created_at"> & { revisao: string };
const colunas = Prisma.sql`id_condominio, nome_residencial, cep, endereco, ativo, created_at, xmin::text AS revisao`;

export async function consultarCondominioAdmin(tx: Prisma.TransactionClient, id: string, bloquear = false) {
  const linhas = await tx.$queryRaw<CondominioVersionado[]>(Prisma.sql`
    SELECT ${colunas} FROM public.condominio WHERE id_condominio = ${id}::uuid
    ${bloquear ? Prisma.sql`FOR UPDATE` : Prisma.empty}
  `);
  return linhas[0] ?? null;
}

export async function consultarCondominiosAdmin(tx: Prisma.TransactionClient, filtros: ListarCondominiosAdminQuery) {
  // strpos mantém busca literal (inclusive % e _), sem interpolação de SQL.
  const where = Prisma.sql`WHERE (${filtros.ativo ?? null}::boolean IS NULL OR ativo = ${filtros.ativo ?? null}::boolean)
    AND (${filtros.busca ?? null}::text IS NULL OR strpos(lower(nome_residencial), lower(${filtros.busca ?? null}::text)) > 0)`;
  const linhas = await tx.$queryRaw<CondominioVersionado[]>(Prisma.sql`
    SELECT ${colunas} FROM public.condominio ${where}
    ORDER BY nome_residencial ASC, id_condominio ASC LIMIT ${filtros.limite} OFFSET ${(filtros.pagina - 1) * filtros.limite}
  `);
  const contagem = await tx.$queryRaw<{ total: bigint }[]>(Prisma.sql`SELECT count(*) AS total FROM public.condominio ${where}`);
  return { linhas, total: Number(contagem[0]!.total) };
}

export function gravarCondominioAdmin(tx: Prisma.TransactionClient, id: string, dados: Omit<EditarCondominioBody, "versao"> | { ativo: boolean }) {
  return tx.condominio.update({ where: { id_condominio: id }, data: dados, select: { id_condominio: true } });
}
