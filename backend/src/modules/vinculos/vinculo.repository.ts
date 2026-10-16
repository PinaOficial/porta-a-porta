import { prisma } from "../../lib/prisma.js";
import type { Prisma } from "../../generated/prisma/client.js";
import type { OnboardingBody } from "../usuarios/usuario.schema.js";
import type { ListarVinculosPendentesQuery } from "./vinculo.schema.js";

const camposDaFilaPendente = {
  id_vinculo: true,
  status_vinculo: true,
  moradia: true,
  data_solicitacao: true,
  condomino: { select: { id_condomino: true, nome_completo: true } },
  condominio: { select: { id_condominio: true, nome_residencial: true } },
} satisfies Prisma.vinculo_condominioSelect;

export type VinculoPendenteConsultado = Prisma.vinculo_condominioGetPayload<{
  select: typeof camposDaFilaPendente;
}>;

type FiltrosVinculosPendentes = Pick<ListarVinculosPendentesQuery, "id_condominio" | "busca" | "limite"> & {
  deslocamento: number;
};

const camposDaDecisao = {
  ...camposDaFilaPendente,
  admin_condominio: true,
  data_aprovacao: true,
  data_inicio: true,
  data_fim: true,
} satisfies Prisma.vinculo_condominioSelect;

export type VinculoDecididoConsultado = Prisma.vinculo_condominioGetPayload<{
  select: typeof camposDaDecisao;
}>;

export function buscarVinculoParaAnalise(tx: Prisma.TransactionClient, idVinculo: string) {
  return tx.vinculo_condominio.findUnique({
    where: { id_vinculo: idVinculo },
    select: {
      id_vinculo: true, id_condomino: true, id_condominio: true, status_vinculo: true,
      admin_condominio: true, data_aprovacao: true, data_inicio: true, data_fim: true,
    },
  });
}

export function buscarOutroVinculoAtivo(tx: Prisma.TransactionClient, idCondomino: string, idVinculo: string) {
  return tx.vinculo_condominio.findFirst({
    where: { id_condomino: idCondomino, status_vinculo: "ATIVO", id_vinculo: { not: idVinculo } },
    select: { id_vinculo: true, id_condominio: true },
  });
}

export function atualizarVinculoPendenteParaAtivo(
  tx: Prisma.TransactionClient, idVinculo: string, idCondominio: string, idAtor: string, instante: Date,
) {
  return tx.vinculo_condominio.updateMany({
    where: { id_vinculo: idVinculo, id_condominio: idCondominio, status_vinculo: "PENDENTE" },
    data: {
      status_vinculo: "ATIVO", data_aprovacao: instante, data_inicio: instante, aprovado_por: idAtor,
      admin_condominio: false, data_fim: null,
    },
  });
}

export function atualizarVinculoPendenteParaRejeitado(
  tx: Prisma.TransactionClient, idVinculo: string, idCondominio: string, idAtor: string,
) {
  return tx.vinculo_condominio.updateMany({
    where: {
      id_vinculo: idVinculo, id_condominio: idCondominio, status_vinculo: "PENDENTE",
      admin_condominio: false, data_aprovacao: null, data_inicio: null, data_fim: null,
    },
    data: { status_vinculo: "REJEITADO", aprovado_por: idAtor },
  });
}

export function buscarVinculoAposDecisao(tx: Prisma.TransactionClient, idVinculo: string) {
  return tx.vinculo_condominio.findUniqueOrThrow({ where: { id_vinculo: idVinculo }, select: camposDaDecisao });
}

export function atualizarVinculoAtivoParaSuspenso(tx: Prisma.TransactionClient, idVinculo: string, idCondominio: string) {
  return tx.vinculo_condominio.updateMany({
    where: { id_vinculo: idVinculo, id_condominio: idCondominio, status_vinculo: "ATIVO" },
    data: { status_vinculo: "SUSPENSO" },
  });
}

export async function buscarVinculosPendentes(filtros: FiltrosVinculosPendentes) {
  const where: Prisma.vinculo_condominioWhereInput = {
    status_vinculo: "PENDENTE",
    ...(filtros.id_condominio ? { id_condominio: filtros.id_condominio } : {}),
    ...(filtros.busca ? {
      OR: [
        { condomino: { is: { nome_completo: { contains: filtros.busca, mode: "insensitive" } } } },
        { moradia: { contains: filtros.busca, mode: "insensitive" } },
      ],
    } : {}),
  };

  // Contagem e itens compartilham filtros e snapshot, sem consultar cada morador separadamente.
  const [vinculos, total] = await prisma.$transaction([
    prisma.vinculo_condominio.findMany({
      where,
      select: camposDaFilaPendente,
      orderBy: [{ data_solicitacao: "asc" }, { id_vinculo: "asc" }],
      skip: filtros.deslocamento,
      take: filtros.limite,
    }),
    prisma.vinculo_condominio.count({ where }),
  ], { isolationLevel: "RepeatableRead" });

  return { vinculos, total };
}

const camposDaSituacaoResidencial = {
  id_vinculo: true,
  status_vinculo: true,
  moradia: true,
  admin_condominio: true,
  data_solicitacao: true,
  data_aprovacao: true,
  data_inicio: true,
  data_fim: true,
  condominio: {
    select: { id_condominio: true, nome_residencial: true, cep: true, endereco: true },
  },
} satisfies Prisma.vinculo_condominioSelect;

export type VinculoConsultado = Prisma.vinculo_condominioGetPayload<{
  select: typeof camposDaSituacaoResidencial;
}>;

export function buscarSituacaoResidencialDoUsuario(idUsuario: string) {
  return prisma.$transaction(async (tx) => {
    const usuario = await tx.usuario.findUnique({
      where: { id_usuario: idUsuario },
      select: {
        condomino: { select: { id_condomino: true } },
        super_admin: { select: { id_super_admin: true } },
      },
    });

    // Consultar a tabela de vínculos diretamente preserva a cardinalidade histórica real.
    // Não usar a relação singular introspectada em condomino.vinculo_condominio.
    const [ativos, pendentes, historico] = usuario?.condomino && !usuario.super_admin
      ? await Promise.all([
        tx.vinculo_condominio.findMany({
          where: { id_condomino: idUsuario, status_vinculo: "ATIVO" },
          select: camposDaSituacaoResidencial,
          take: 2,
        }),
        tx.vinculo_condominio.findMany({
          where: { id_condomino: idUsuario, status_vinculo: "PENDENTE" },
          select: camposDaSituacaoResidencial,
          take: 2,
        }),
        tx.vinculo_condominio.findFirst({
          where: { id_condomino: idUsuario, status_vinculo: { in: ["REJEITADO", "SUSPENSO", "ENCERRADO"] } },
          select: camposDaSituacaoResidencial,
          orderBy: [{ data_solicitacao: "desc" }, { id_vinculo: "desc" }],
        }),
      ])
      : [[], [], null];

    return { usuario, ativos, pendentes, historico };
  }, { isolationLevel: "RepeatableRead" });
}

export function buscarVinculoAtivoDoUsuario(idUsuario: string) {
  return prisma.vinculo_condominio.findFirst({
    where: { id_condomino: idUsuario, status_vinculo: "ATIVO" },
    select: { id_vinculo: true, id_condominio: true, admin_condominio: true },
  });
}

export function criarVinculoPendenteDoOnboarding(tx: Prisma.TransactionClient, idUsuario: string, dados: OnboardingBody) {
  return tx.vinculo_condominio.create({
    data: {
      id_condomino: idUsuario,
      id_condominio: dados.id_condominio,
      moradia: dados.moradia,
      admin_condominio: false,
      status_vinculo: "PENDENTE",
    },
    select: {
      id_vinculo: true,
      id_condominio: true,
      moradia: true,
      status_vinculo: true,
      admin_condominio: true,
    },
  });
}

export async function bloquearAdministracaoCondominios(tx: Prisma.TransactionClient, idsCondominios: string[]) {
  // Mutex transacional por condomínio, em ordem fixa; não conflita com FKs de pedidos/produtos.
  for (const id of [...new Set(idsCondominios)].sort()) {
    await tx.$queryRaw`SELECT 1 AS bloqueado FROM pg_advisory_xact_lock(hashtextextended(${id}::text, 21))`;
  }
}

export function bloquearVinculoParaAdministracao(tx: Prisma.TransactionClient, idVinculo: string) {
  return tx.$queryRaw`SELECT id_vinculo FROM public.vinculo_condominio WHERE id_vinculo = ${idVinculo}::uuid FOR UPDATE`;
}

export async function buscarAdminComBloqueio(tx: Prisma.TransactionClient, idVinculo: string) {
  const vinculos = await tx.$queryRaw<{ id_condomino: string; id_condominio: string; admin_condominio: boolean; status_vinculo: string }[]>`
    SELECT id_condomino, id_condominio, admin_condominio, status_vinculo
    FROM public.vinculo_condominio WHERE id_vinculo = ${idVinculo}::uuid FOR SHARE
  `;
  return vinculos[0] ?? null;
}

export function buscarOutrosAdminsAtivosComBloqueio(tx: Prisma.TransactionClient, idCondominio: string, idVinculo: string) {
  return tx.$queryRaw<{ id_vinculo: string }[]>`
    SELECT id_vinculo FROM public.vinculo_condominio
    WHERE id_condominio = ${idCondominio}::uuid AND id_vinculo <> ${idVinculo}::uuid
      AND status_vinculo = 'ATIVO' AND admin_condominio = true
    ORDER BY id_vinculo FOR SHARE
  `;
}

export function encerrarVinculoTransferido(tx: Prisma.TransactionClient, idVinculo: string, instante: Date) {
  return tx.vinculo_condominio.updateMany({
    where: { id_vinculo: idVinculo, status_vinculo: "ATIVO" },
    data: { status_vinculo: "ENCERRADO", data_fim: instante },
  });
}

export function bloquearPerfilParaTransferencia(tx: Prisma.TransactionClient, idUsuario: string) {
  return tx.$queryRaw`SELECT id_condomino FROM public.condomino WHERE id_condomino = ${idUsuario}::uuid FOR UPDATE`;
}

export function buscarVinculoAtivoParaTransferencia(tx: Prisma.TransactionClient, idUsuario: string) {
  return tx.vinculo_condominio.findFirst({
    where: { id_condomino: idUsuario, status_vinculo: "ATIVO" },
    select: { id_vinculo: true, id_condominio: true },
  });
}

export function buscarSolicitacaoPendente(tx: Prisma.TransactionClient, idUsuario: string) {
  return tx.vinculo_condominio.findFirst({ where: { id_condomino: idUsuario, status_vinculo: "PENDENTE" }, select: { id_vinculo: true } });
}

export function criarSolicitacaoTransferencia(tx: Prisma.TransactionClient, idUsuario: string, dados: { id_condominio: string; moradia: string }) {
  return tx.vinculo_condominio.create({
    data: { id_condomino: idUsuario, ...dados, status_vinculo: "PENDENTE", admin_condominio: false },
    select: { id_vinculo: true, id_condominio: true, moradia: true, status_vinculo: true, admin_condominio: true, data_solicitacao: true },
  });
}

export async function listarVinculosAdministrativos(tx: Prisma.TransactionClient, filtros: {
  id_condominio?: string; status?: Prisma.vinculo_condominioWhereInput["status_vinculo"]; busca?: string; limite: number; deslocamento: number;
}) {
  const where: Prisma.vinculo_condominioWhereInput = {
    ...(filtros.id_condominio ? { id_condominio: filtros.id_condominio } : {}),
    ...(filtros.status ? { status_vinculo: filtros.status } : {}),
    ...(filtros.busca ? { OR: [
      { condomino: { is: { nome_completo: { contains: filtros.busca, mode: "insensitive" } } } },
      { moradia: { contains: filtros.busca, mode: "insensitive" } },
    ] } : {}),
  };
  const vinculos = await tx.vinculo_condominio.findMany({
    where, select: { ...camposDaFilaPendente, admin_condominio: true, data_inicio: true },
    orderBy: [{ data_solicitacao: "asc" }, { id_vinculo: "asc" }], skip: filtros.deslocamento, take: filtros.limite,
  });
  const total = await tx.vinculo_condominio.count({ where });
  return { vinculos, total };
}

export function atualizarAdminVinculo(tx: Prisma.TransactionClient, idVinculo: string, admin: boolean, idAtor: string, instante: Date) {
  return tx.vinculo_condominio.updateMany({
    where: { id_vinculo: idVinculo, status_vinculo: "ATIVO", admin_condominio: !admin },
    data: { admin_condominio: admin, admin_atualizado_por: idAtor, admin_atualizado_em: instante },
  });
}

export function buscarAdminVinculoAposAlteracao(tx: Prisma.TransactionClient, idVinculo: string) {
  return tx.vinculo_condominio.findUniqueOrThrow({
    where: { id_vinculo: idVinculo }, select: { id_vinculo: true, admin_condominio: true, admin_atualizado_em: true },
  });
}
