type DecimalValue = { toString(): string } | number | string;

function money(value: DecimalValue) {
  return Number(value.toString());
}

export function toApartamentoDto(apartamento: {
  id: string; condominio_id: string; numero: string; bloco: string; ativo: boolean; tipo_unidade: string;
}) {
  return { id: apartamento.id, condominioId: apartamento.condominio_id, numero: apartamento.numero, bloco: apartamento.bloco, tipoUnidade: apartamento.tipo_unidade, ativo: apartamento.ativo };
}

export function toMembroDto(vinculo: {
  id: string; condomino_id: string; tipo_vinculo: string; ativo: boolean; criado_em: Date; desvinculado_em: Date | null;
  condominos: { nome: string; email: string | null }; apartamentos: { id: string; numero: string; bloco: string; tipo_unidade: string };
}) {
  return {
    vinculoId: vinculo.id, condominoId: vinculo.condomino_id, nome: vinculo.condominos.nome, email: vinculo.condominos.email,
    apartamento: { id: vinculo.apartamentos.id, numero: vinculo.apartamentos.numero, bloco: vinculo.apartamentos.bloco, tipoUnidade: vinculo.apartamentos.tipo_unidade },
    tipoVinculo: vinculo.tipo_vinculo, ativo: vinculo.ativo, criadoEm: vinculo.criado_em, desvinculadoEm: vinculo.desvinculado_em,
  };
}

export function toCategoriaDto(categoria: { id: string; nome: string; descricao: string | null }) {
  return { id: categoria.id, nome: categoria.nome, descricao: categoria.descricao };
}

export function toProdutoDto(produto: {
  id: string; condominio_id: string; vendedor_vinculo_id: string; categoria_id: string; nome: string; descricao: string | null;
  preco: DecimalValue; estoque: number; ativo: boolean; categorias_produto: { nome: string };
  condomino_apartamentos: { condominos: { nome: string } };
}) {
  return {
    id: produto.id, condominioId: produto.condominio_id, vendedorVinculoId: produto.vendedor_vinculo_id,
    categoria: { id: produto.categoria_id, nome: produto.categorias_produto.nome }, nome: produto.nome,
    descricao: produto.descricao, preco: money(produto.preco), estoque: produto.estoque, ativo: produto.ativo,
    vendedor: { nome: produto.condomino_apartamentos.condominos.nome },
  };
}

export function toCarrinhoDto(carrinho: {
  id: string; condominio_id: string; status: string;
  carrinho_itens: Array<{ id: string; quantidade: number; produtos: Parameters<typeof toProdutoDto>[0] }>;
}) {
  return {
    id: carrinho.id, condominioId: carrinho.condominio_id, status: carrinho.status,
    itens: carrinho.carrinho_itens.map((item) => ({ id: item.id, quantidade: item.quantidade, produto: toProdutoDto(item.produtos) })),
  };
}

export function toPedidoDto(pedido: {
  id: string; condominio_id: string; comprador_vinculo_id: string; vendedor_vinculo_id: string; status: string; observacao: string | null; criado_em: Date;
  pedido_itens: Array<{ id: string; produto_id: string; quantidade: number; preco_unitario: DecimalValue; nome_produto: string }>;
}) {
  return {
    id: pedido.id, condominioId: pedido.condominio_id, compradorVinculoId: pedido.comprador_vinculo_id,
    vendedorVinculoId: pedido.vendedor_vinculo_id, status: pedido.status, observacao: pedido.observacao, criadoEm: pedido.criado_em,
    itens: pedido.pedido_itens.map((item) => ({ id: item.id, produtoId: item.produto_id, nomeProduto: item.nome_produto, quantidade: item.quantidade, precoUnitario: money(item.preco_unitario) })),
  };
}
