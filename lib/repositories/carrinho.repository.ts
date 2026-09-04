import "server-only";
import { prisma } from "@/lib/db/prisma";

const cartInclude = { carrinho_itens: { include: { produtos: { include: { categorias_produto: { select: { nome: true } }, condomino_apartamentos: { select: { condominos: { select: { nome: true } } } } } } } } } as const;

export function buscarCarrinhoAberto(condominioId: string, vinculoId: string) {
  return prisma.carrinhos.findFirst({ where: { condominio_id: condominioId, comprador_vinculo_id: vinculoId, status: "aberto" }, include: cartInclude });
}
export async function adicionarItemAoCarrinho(data: { condominioId: string; compradorVinculoId: string; produtoId: string; quantidade: number }) {
  return prisma.$transaction(async (tx) => {
    const produto = await tx.produtos.findFirst({ where: { id: data.produtoId, condominio_id: data.condominioId, ativo: true, estoque: { gte: data.quantidade }, vendedor_vinculo_id: { not: data.compradorVinculoId }, condomino_apartamentos: { ativo: true } }, select: { id: true } });
    if (!produto) return null;
    let carrinho = await tx.carrinhos.findFirst({ where: { condominio_id: data.condominioId, comprador_vinculo_id: data.compradorVinculoId, status: "aberto" }, select: { id: true } });
    if (!carrinho) carrinho = await tx.carrinhos.create({ data: { condominio_id: data.condominioId, comprador_vinculo_id: data.compradorVinculoId }, select: { id: true } });
    const existing = await tx.carrinho_itens.findFirst({ where: { carrinho_id: carrinho.id, produto_id: data.produtoId }, select: { id: true, quantidade: true } });
    if (existing) await tx.carrinho_itens.update({ where: { id: existing.id }, data: { quantidade: data.quantidade, atualizado_em: new Date() } });
    else await tx.carrinho_itens.create({ data: { carrinho_id: carrinho.id, produto_id: data.produtoId, condominio_id: data.condominioId, quantidade: data.quantidade } });
    return tx.carrinhos.findFirst({ where: { id: carrinho.id, condominio_id: data.condominioId }, include: cartInclude });
  });
}
export async function atualizarItemDoCarrinho(data: { condominioId: string; compradorVinculoId: string; itemId: string; quantidade: number }) {
  const item = await prisma.carrinho_itens.findFirst({ where: { id: data.itemId, condominio_id: data.condominioId, carrinhos: { comprador_vinculo_id: data.compradorVinculoId, status: "aberto" }, produtos: { ativo: true, estoque: { gte: data.quantidade } } }, select: { id: true, carrinho_id: true } });
  if (!item) return null;
  await prisma.carrinho_itens.update({ where: { id: item.id }, data: { quantidade: data.quantidade, atualizado_em: new Date() } });
  return prisma.carrinhos.findFirst({ where: { id: item.carrinho_id, condominio_id: data.condominioId }, include: cartInclude });
}
export async function removerItemDoCarrinho(data: { condominioId: string; compradorVinculoId: string; itemId: string }) {
  const result = await prisma.carrinho_itens.deleteMany({ where: { id: data.itemId, condominio_id: data.condominioId, carrinhos: { comprador_vinculo_id: data.compradorVinculoId, status: "aberto" } } });
  return result.count > 0;
}
