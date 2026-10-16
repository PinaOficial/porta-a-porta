import type { Prisma, status_pedido_enum, vinculo_condominio } from "../../generated/prisma/client.js";
import type { ListarMeusPedidosQuery } from "./pedido.schema.js";

export function buscarPerfilParaHistoricoPedidos(tx: Prisma.TransactionClient, idUsuario: string) {
  return tx.condomino.findUnique({ where: { id_condomino: idUsuario }, select: { id_condomino: true } });
}

export function buscarVinculosDoHistoricoPedidos(tx: Prisma.TransactionClient, idUsuario: string) {
  // A relação singular em condomino não representa todos os vínculos históricos.
  return tx.vinculo_condominio.findMany({ where: { id_condomino: idUsuario }, select: { id_vinculo: true } });
}

const camposContrapartePedido = {
  moradia: true,
  condomino: { select: { nome_completo: true } },
} satisfies Prisma.vinculo_condominioSelect;

export async function listarPedidosDosVinculos(
  tx: Prisma.TransactionClient, idsVinculos: string[],
  filtros: Pick<ListarMeusPedidosQuery, "papel" | "status" | "limite"> & { deslocamento: number },
) {
  const compra: Prisma.pedidoWhereInput = { id_vinculo_comprador: { in: idsVinculos } };
  const venda: Prisma.pedidoWhereInput = { produto: { is: { id_vinculo_vendedor: { in: idsVinculos } } } };
  const where: Prisma.pedidoWhereInput = {
    ...(filtros.papel === "compra" ? compra : filtros.papel === "venda" ? venda : { OR: [compra, venda] }),
    ...(filtros.status ? { status_pedido: filtros.status } : {}),
  };
  const pedidos = await tx.pedido.findMany({
    where,
    select: {
      id_pedido: true, id_vinculo_comprador: true, quantidade: true, valor_pedido: true, status_pedido: true,
      hora_solicitacao: true, hora_combinada: true, ultima_atualizacao: true,
      produto: { select: {
        id_produto: true, nome_produto: true,
        vinculo_condominio: { select: camposContrapartePedido },
      } },
      vinculo_condominio: { select: {
        ...camposContrapartePedido,
        condominio: { select: { id_condominio: true, nome_residencial: true } },
      } },
      pedido_status_historico: {
        select: { status_anterior: true, status_novo: true, motivo: true, created_at: true },
        orderBy: [{ created_at: "asc" }, { id_historico: "asc" }],
      },
      conversa: { select: { status_conversa: true } },
    },
    orderBy: [{ hora_solicitacao: "desc" }, { id_pedido: "desc" }],
    skip: filtros.deslocamento, take: filtros.limite,
  });
  const total = await tx.pedido.count({ where });
  return { pedidos, total };
}

type VinculoParaPedido = Pick<vinculo_condominio, "id_vinculo" | "id_condomino" | "id_condominio" | "status_vinculo">;

export async function buscarVinculoBloqueadoParaPedido(tx: Prisma.TransactionClient, idVinculo: string) {
  // Prisma não expõe FOR SHARE no findUnique. SQL parametrizado mantém o vínculo
  // estável até o commit, inclusive frente a suspensões via updateMany.
  const vinculos = await tx.$queryRaw<VinculoParaPedido[]>`
    SELECT id_vinculo, id_condomino, id_condominio, status_vinculo
    FROM public.vinculo_condominio WHERE id_vinculo = ${idVinculo}::uuid FOR SHARE
  `;
  return vinculos[0] ?? null;
}

export function buscarProdutoParaPedido(tx: Prisma.TransactionClient, idProduto: string) {
  return tx.produto.findUnique({
    where: { id_produto: idProduto },
    select: {
      id_produto: true, id_vinculo_vendedor: true, nome_produto: true, preco: true, estoque: true, ativo: true,
      vinculo_condominio: { select: { id_vinculo: true, id_condomino: true, id_condominio: true, status_vinculo: true } },
    },
  });
}

export function reservarEstoquePedido(tx: Prisma.TransactionClient, idProduto: string, idVendedor: string, quantidade: number) {
  return tx.produto.updateMany({
    where: { id_produto: idProduto, id_vinculo_vendedor: idVendedor, ativo: true, estoque: { gte: quantidade } },
    data: { estoque: { decrement: quantidade } },
  });
}

export function inserirPedido(tx: Prisma.TransactionClient, dados: Pick<Prisma.pedidoUncheckedCreateInput,
  "id_produto" | "id_vinculo_comprador" | "quantidade" | "valor_pedido" | "hora_solicitacao" | "hora_combinada" | "ultima_atualizacao"
>) {
  return tx.pedido.create({
    data: { ...dados, status_pedido: "SOLICITADO" },
    select: {
      id_pedido: true, id_produto: true, quantidade: true, valor_pedido: true, status_pedido: true,
      hora_solicitacao: true, hora_combinada: true, ultima_atualizacao: true,
      produto: { select: { id_produto: true, nome_produto: true } },
    },
  });
}

export function criarHistoricoInicialPedido(tx: Prisma.TransactionClient, idPedido: string, idComprador: string, instante: Date) {
  return tx.pedido_status_historico.create({
    data: { id_pedido: idPedido, status_anterior: null, status_novo: "SOLICITADO", alterado_por: idComprador, motivo: null, created_at: instante },
    select: { id_historico: true },
  });
}

export function buscarPedidoDaNegociacao(tx: Prisma.TransactionClient, idPedido: string) {
  return tx.pedido.findUnique({
    where: { id_pedido: idPedido },
    select: {
      id_pedido: true, id_produto: true, quantidade: true, status_pedido: true,
      vinculo_condominio: { select: { id_condomino: true } },
      produto: { select: { vinculo_condominio: { select: { id_condomino: true } } } },
    },
  });
}

export function atualizarStatusPedidoCondicional(
  tx: Prisma.TransactionClient, idPedido: string,
  statusAnterior: status_pedido_enum, statusNovo: status_pedido_enum, instante: Date,
) {
  return tx.pedido.updateMany({
    where: { id_pedido: idPedido, status_pedido: statusAnterior },
    data: { status_pedido: statusNovo, ultima_atualizacao: instante },
  });
}

export function devolverEstoquePedido(tx: Prisma.TransactionClient, idProduto: string, quantidade: number) {
  return tx.produto.update({ where: { id_produto: idProduto }, data: { estoque: { increment: quantidade } }, select: { id_produto: true } });
}

export function criarHistoricoTransicaoPedido(tx: Prisma.TransactionClient, dados: Pick<Prisma.pedido_status_historicoUncheckedCreateInput,
  "id_pedido" | "status_anterior" | "status_novo" | "alterado_por" | "motivo" | "created_at"
>) {
  return tx.pedido_status_historico.create({ data: dados, select: { id_historico: true } });
}

export function buscarPedidoAbertoDoVinculo(tx: Prisma.TransactionClient, idVinculo: string) {
  return tx.pedido.findFirst({
    where: {
      status_pedido: { in: ["SOLICITADO", "ACEITO"] },
      OR: [{ id_vinculo_comprador: idVinculo }, { produto: { is: { id_vinculo_vendedor: idVinculo } } }],
    }, select: { id_pedido: true },
  });
}
