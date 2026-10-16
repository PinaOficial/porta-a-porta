import type { Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../../lib/prisma.js";
import type { CriarProdutoBody, EditarProdutoBody, ListarMeusProdutosQuery, ListarProdutosQuery } from "./produto.schema.js";

export async function buscarImagemDoProduto(idProduto: string, idImagem: string) {
  return prisma.produto_imagem.findFirst({
    where: { id_imagem: idImagem, id_produto: idProduto },
    select: { id_imagem: true, storage_path: true },
  });
}

export async function excluirRegistroImagemProduto(idProduto: string, idImagem: string) {
  return prisma.produto_imagem.delete({
    where: { id_imagem: idImagem, id_produto: idProduto },
    select: { id_imagem: true },
  });
}

export async function buscarMaiorOrdemImagem(idProduto: string): Promise<number | null> {
  const resultado = await prisma.produto_imagem.aggregate({ where: { id_produto: idProduto }, _max: { ordem: true } });
  return resultado._max.ordem;
}

export async function criarImagemProduto(idProduto: string, storagePath: string, ordem: number) {
  return prisma.produto_imagem.create({
    data: { id_produto: idProduto, storage_path: storagePath, ordem },
    select: { id_imagem: true, id_produto: true, ordem: true, created_at: true },
  });
}

export async function criarProduto(
  idVinculoVendedor: string,
  dados: Omit<CriarProdutoBody, "preco"> & { preco: Prisma.Decimal },
  tx: Prisma.TransactionClient = prisma,
) {
  return tx.produto.create({
    data: {
      id_vinculo_vendedor: idVinculoVendedor,
      id_categoria: dados.id_categoria,
      nome_produto: dados.nome_produto,
      descricao: dados.descricao,
      preco: dados.preco,
      estoque: dados.estoque,
    },
    select: {
      id_produto: true, nome_produto: true, descricao: true, preco: true, estoque: true,
      ativo: true, created_at: true,
      categoria_produto: { select: { id_categoria: true, nome: true } },
    },
  });
}

const camposBasicosProduto = {
  id_produto: true,
  nome_produto: true,
  descricao: true,
  preco: true,
  estoque: true,
  created_at: true,
} satisfies Prisma.produtoSelect;

const camposDoVendedor = {
  ...camposBasicosProduto, ativo: true, updated_at: true,
  categoria_produto: { select: { id_categoria: true, nome: true, ativo: true } },
} satisfies Prisma.produtoSelect;

const camposImagens = {
  select: { id_imagem: true, storage_path: true, ordem: true },
  orderBy: [{ ordem: "asc" }, { id_imagem: "asc" }],
} satisfies Prisma.produto_imagemFindManyArgs;

export async function buscarProdutoDoVinculo(idProduto: string, idVinculoVendedor: string) {
  return prisma.produto.findFirst({
    where: { id_produto: idProduto, id_vinculo_vendedor: idVinculoVendedor },
    select: { id_produto: true, id_categoria: true },
  });
}

export async function atualizarProdutoDoVinculo(
  idProduto: string,
  idVinculoVendedor: string,
  dados: Omit<EditarProdutoBody, "preco"> & { preco?: Prisma.Decimal },
  tx: Prisma.TransactionClient = prisma,
) {
  return tx.produto.update({
    where: { id_produto: idProduto, id_vinculo_vendedor: idVinculoVendedor },
    data: {
      ...(dados.id_categoria !== undefined ? { id_categoria: dados.id_categoria } : {}),
      ...(dados.nome_produto !== undefined ? { nome_produto: dados.nome_produto } : {}),
      ...(dados.descricao !== undefined ? { descricao: dados.descricao } : {}),
      ...(dados.preco !== undefined ? { preco: dados.preco } : {}),
      ...(dados.estoque !== undefined ? { estoque: dados.estoque } : {}),
    },
    select: camposDoVendedor,
  });
}

export async function atualizarStatusProdutoDoVinculo(idProduto: string, idVinculoVendedor: string, ativo: boolean, tx: Prisma.TransactionClient = prisma) {
  return tx.produto.update({
    where: { id_produto: idProduto, id_vinculo_vendedor: idVinculoVendedor },
    data: { ativo },
    select: camposDoVendedor,
  });
}

const camposDaVitrine = {
  ...camposBasicosProduto,
  categoria_produto: { select: { id_categoria: true, nome: true } },
  vinculo_condominio: {
    select: { id_vinculo: true, moradia: true, condomino: { select: { nome_completo: true } } },
  },
  produto_imagem: camposImagens,
} satisfies Prisma.produtoSelect;

type FiltrosProdutos = Pick<ListarProdutosQuery, "id_categoria" | "busca" | "limite"> & {
  deslocamento: number;
};

const ordenacaoProdutos = [{ created_at: "desc" }, { id_produto: "asc" }] satisfies Prisma.produtoOrderByWithRelationInput[];

function montarFiltrosDeCategoriaEBusca(filtros: Pick<ListarProdutosQuery, "id_categoria" | "busca">): Prisma.produtoWhereInput {
  return {
    ...(filtros.id_categoria ? { id_categoria: filtros.id_categoria } : {}),
    ...(filtros.busca
      ? { OR: [
        { nome_produto: { contains: filtros.busca, mode: "insensitive" } },
        { descricao: { contains: filtros.busca, mode: "insensitive" } },
      ] }
      : {}),
  };
}

export async function listarProdutosDoVinculo(
  idVinculoVendedor: string,
  filtros: Pick<ListarMeusProdutosQuery, "id_categoria" | "busca" | "ativo" | "limite"> & { deslocamento: number },
) {
  const where: Prisma.produtoWhereInput = {
    id_vinculo_vendedor: idVinculoVendedor,
    ...montarFiltrosDeCategoriaEBusca(filtros),
    ...(filtros.ativo !== undefined ? { ativo: filtros.ativo } : {}),
  };
  const [produtos, total] = await prisma.$transaction([
    prisma.produto.findMany({
      where,
      select: { ...camposDoVendedor, produto_imagem: camposImagens },
      orderBy: ordenacaoProdutos,
      skip: filtros.deslocamento,
      take: filtros.limite,
    }),
    prisma.produto.count({ where }),
  ], { isolationLevel: "RepeatableRead" });
  return { produtos, total };
}

export async function listarProdutosDoCondominio(
  idCondominio: string,
  filtros: FiltrosProdutos,
) {
  const where: Prisma.produtoWhereInput = {
    ativo: true,
    categoria_produto: { is: { ativo: true } },
    vinculo_condominio: {
      is: { status_vinculo: "ATIVO", id_condominio: idCondominio },
    },
    ...montarFiltrosDeCategoriaEBusca(filtros),
  };

  // A página e o total devem observar o mesmo snapshot, inclusive sob alterações concorrentes.
  const [produtos, total] = await prisma.$transaction([
    prisma.produto.findMany({
      where,
      select: camposDaVitrine,
      orderBy: ordenacaoProdutos,
      skip: filtros.deslocamento,
      take: filtros.limite,
    }),
    prisma.produto.count({ where }),
  ], { isolationLevel: "RepeatableRead" });

  return { produtos, total };
}

export function desativarProdutosDoVinculo(tx: Prisma.TransactionClient, idVinculo: string) {
  return tx.produto.updateMany({ where: { id_vinculo_vendedor: idVinculo }, data: { ativo: false } });
}

export function buscarDetalheProduto(idProduto: string, idCondominio: string, idVinculoProprio?: string) {
  return prisma.produto.findFirst({
    where: {
      id_produto: idProduto,
      vinculo_condominio: { is: { id_condominio: idCondominio, status_vinculo: "ATIVO" } },
      OR: [
        { ativo: true, categoria_produto: { is: { ativo: true } } },
        ...(idVinculoProprio ? [{ id_vinculo_vendedor: idVinculoProprio }] : []),
      ],
    },
    select: { ...camposDoVendedor, produto_imagem: camposImagens, vinculo_condominio: camposDaVitrine.vinculo_condominio },
  });
}
