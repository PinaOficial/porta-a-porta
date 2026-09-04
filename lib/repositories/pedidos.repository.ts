import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";

const orderInclude = { pedido_itens: { orderBy: { criado_em: "asc" } } } as const;
export function listarPedidos(params: { condominioId: string; vinculoId: string | null; admin: boolean; status?: "solicitado" | "aceito" | "recusado" | "concluido"; tipo?: "compras" | "vendas"; skip: number; take: number }) {
  const participant = params.admin ? {} : params.tipo === "compras" ? { comprador_vinculo_id: params.vinculoId ?? "" } : params.tipo === "vendas" ? { vendedor_vinculo_id: params.vinculoId ?? "" } : { OR: [{ comprador_vinculo_id: params.vinculoId ?? "" }, { vendedor_vinculo_id: params.vinculoId ?? "" }] };
  const where: Prisma.pedidosWhereInput = { condominio_id: params.condominioId, ...participant, ...(params.status ? { status: params.status } : {}) };
  return Promise.all([prisma.pedidos.findMany({ where, include: orderInclude, orderBy: { criado_em: "desc" }, skip: params.skip, take: params.take }), prisma.pedidos.count({ where })]);
}
export function buscarPedido(condominioId: string, id: string) {
  return prisma.pedidos.findFirst({ where: { id, condominio_id: condominioId }, include: orderInclude });
}
export function atualizarStatusPedido(condominioId: string, id: string, status: "aceito" | "recusado" | "concluido") {
  return prisma.pedidos.update({ where: { id }, data: { status, atualizado_em: new Date() }, include: orderInclude });
}

export async function checkoutCarrinho(condominioId: string, compradorVinculoId: string) {
  return prisma.$transaction(async (tx) => {
    const carrinho = await tx.carrinhos.findFirst({
      where: { condominio_id: condominioId, comprador_vinculo_id: compradorVinculoId, status: "aberto" },
      include: { carrinho_itens: { include: { produtos: true } } },
    });
    if (!carrinho || carrinho.carrinho_itens.length === 0) return null;

    const bySeller = new Map<string, typeof carrinho.carrinho_itens>();
    for (const item of carrinho.carrinho_itens) {
      if (!item.produtos.ativo || item.produtos.vendedor_vinculo_id === compradorVinculoId) return "invalid" as const;
      const items = bySeller.get(item.produtos.vendedor_vinculo_id) ?? [];
      items.push(item);
      bySeller.set(item.produtos.vendedor_vinculo_id, items);
    }

    const orderIds: string[] = [];
    for (const [sellerVinculoId, items] of bySeller) {
      const order = await tx.pedidos.create({ data: { condominio_id: condominioId, comprador_vinculo_id: compradorVinculoId, vendedor_vinculo_id: sellerVinculoId } });
      orderIds.push(order.id);
      for (const item of items) {
        const product = item.produtos;
        const updated = await tx.produtos.updateMany({
          where: { id: product.id, condominio_id: condominioId, vendedor_vinculo_id: sellerVinculoId, ativo: true, estoque: { gte: item.quantidade }, condomino_apartamentos: { ativo: true } },
          data: { estoque: { decrement: item.quantidade }, atualizado_em: new Date() },
        });
        if (updated.count !== 1) throw new Error("INSUFFICIENT_STOCK");
        await tx.pedido_itens.create({ data: { pedido_id: order.id, produto_id: product.id, vendedor_vinculo_id: sellerVinculoId, condominio_id: condominioId, quantidade: item.quantidade, preco_unitario: product.preco, nome_produto: product.nome } });
      }
    }
    await tx.carrinhos.update({ where: { id_condominio_id: { id: carrinho.id, condominio_id: condominioId } }, data: { status: "finalizado", atualizado_em: new Date() } });
    return tx.pedidos.findMany({ where: { id: { in: orderIds }, condominio_id: condominioId }, include: orderInclude, orderBy: { criado_em: "asc" } });
  });
}
