import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";

const productInclude = {
  categorias_produto: { select: { nome: true } },
  condomino_apartamentos: { select: { condominos: { select: { nome: true } } } },
} as const;

export function listarProdutos(params: { condominioId: string; vinculoId: string | null; includeInactive: boolean; search?: string; categoriaId?: string; mine?: boolean; skip: number; take: number }) {
  const where: Prisma.produtosWhereInput = {
    condominio_id: params.condominioId,
    ...(params.includeInactive ? {} : { ativo: true }),
    ...(params.search ? { nome: { contains: params.search, mode: "insensitive" } } : {}),
    ...(params.categoriaId ? { categoria_id: params.categoriaId } : {}),
    ...(params.mine && params.vinculoId ? { vendedor_vinculo_id: params.vinculoId } : {}),
  };
  return Promise.all([
    prisma.produtos.findMany({ where, include: productInclude, orderBy: { criado_em: "desc" }, skip: params.skip, take: params.take }),
    prisma.produtos.count({ where }),
  ]);
}
export function buscarProduto(condominioId: string, id: string, includeInactive = false) {
  return prisma.produtos.findFirst({ where: { id, condominio_id: condominioId, ...(includeInactive ? {} : { ativo: true }) }, include: productInclude });
}
export function buscarCategoria(id: string) {
  return prisma.categorias_produto.findUnique({ where: { id }, select: { id: true } });
}
export function criarProduto(data: { condominioId: string; vinculoId: string; categoriaId: string; nome: string; descricao?: string | null; preco: number; estoque: number }) {
  return prisma.produtos.create({ data: { condominio_id: data.condominioId, vendedor_vinculo_id: data.vinculoId, categoria_id: data.categoriaId, nome: data.nome, descricao: data.descricao, preco: data.preco, estoque: data.estoque }, include: productInclude });
}
export function atualizarProduto(condominioId: string, id: string, data: { nome?: string; descricao?: string | null; categoriaId?: string; preco?: number; estoque?: number }) {
  return prisma.produtos.update({ where: { id_condominio_id: { id, condominio_id: condominioId } }, data: { ...(data.nome !== undefined ? { nome: data.nome } : {}), ...(data.descricao !== undefined ? { descricao: data.descricao } : {}), ...(data.categoriaId ? { categoria_id: data.categoriaId } : {}), ...(data.preco !== undefined ? { preco: data.preco } : {}), ...(data.estoque !== undefined ? { estoque: data.estoque } : {}), atualizado_em: new Date() }, include: productInclude });
}
export async function desativarProduto(condominioId: string, id: string) {
  return prisma.$transaction(async (tx) => {
    await tx.produtos.update({ where: { id_condominio_id: { id, condominio_id: condominioId } }, data: { ativo: false, desativado_em: new Date(), atualizado_em: new Date() } });
    await tx.carrinho_itens.deleteMany({ where: { produto_id: id, condominio_id: condominioId, carrinhos: { status: "aberto" } } });
  });
}
