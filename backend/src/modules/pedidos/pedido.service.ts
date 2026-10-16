import { Prisma, type status_pedido_enum } from "../../generated/prisma/client.js";
import { prisma } from "../../lib/prisma.js";
import { ErroDominio } from "../../lib/erro-dominio.js";
import { obterVinculoAtivo } from "../../lib/autorizacao-vitrine.js";
import type { ContextoAutenticado } from "../../types/auth.js";
import { criarConversaDoPedido, criarParticipantesDoPedido } from "../chat/chat.repository.js";
import { buscarPerfilParaHistoricoPedidos, buscarProdutoParaPedido, buscarVinculoBloqueadoParaPedido, buscarVinculosDoHistoricoPedidos, criarHistoricoInicialPedido, inserirPedido, listarPedidosDosVinculos, reservarEstoquePedido } from "./pedido.repository.js";
import type { AtualizarStatusPedidoBody, CriarPedidoBody, ListarMeusPedidosQuery } from "./pedido.schema.js";
import type { MeusPedidos, ResultadoCriacaoPedido, ResultadoStatusPedido } from "./pedido.model.js";
import { atualizarStatusPedidoCondicional, buscarPedidoDaNegociacao, criarHistoricoTransicaoPedido, devolverEstoquePedido } from "./pedido.repository.js";

// Compartilhado com chat: a identidade é a dos vínculos originais da negociação.
export async function obterPedidoDaNegociacao(
  tx: Prisma.TransactionClient, idPedido: string, auth: ContextoAutenticado | undefined, permitirSuperAdmin = false,
) {
  if (!auth) throw new ErroDominio("UNAUTHENTICATED", 401, "Autenticação necessária.");
  const pedido = await buscarPedidoDaNegociacao(tx, idPedido);
  const comprador = pedido?.vinculo_condominio.id_condomino === auth.id_usuario;
  const vendedor = pedido?.produto.vinculo_condominio.id_condomino === auth.id_usuario;
  if (!pedido || (!comprador && !vendedor && !(permitirSuperAdmin && auth.super_admin))) {
    throw new ErroDominio("ORDER_NOT_FOUND", 404, "Pedido não encontrado.");
  }
  return { pedido, comprador, vendedor };
}

const destinosPermitidos: Partial<Record<status_pedido_enum, readonly AtualizarStatusPedidoBody["status"][]>> = {
  SOLICITADO: ["ACEITO", "RECUSADO", "CANCELADO"],
  ACEITO: ["CONCLUIDO", "CANCELADO"],
};

function transicaoInvalida(): never {
  throw new ErroDominio("INVALID_ORDER_TRANSITION", 409, "Transição de pedido inválida ou estado alterado por outra operação.");
}

export async function atualizarStatusPedido(
  auth: ContextoAutenticado | undefined, idPedido: string, dados: AtualizarStatusPedidoBody,
): Promise<ResultadoStatusPedido> {
  return prisma.$transaction(async (tx) => {
    const { pedido, comprador, vendedor } = await obterPedidoDaNegociacao(tx, idPedido, auth);
    if (dados.status === "CANCELADO" ? !comprador : !vendedor) {
      throw new ErroDominio("ORDER_STATUS_FORBIDDEN", 403, "Somente o comprador ou vendedor responsável pode executar esta transição.");
    }
    if (!destinosPermitidos[pedido.status_pedido]?.includes(dados.status)) transicaoInvalida();
    const instante = new Date();
    const alteracao = await atualizarStatusPedidoCondicional(tx, idPedido, pedido.status_pedido, dados.status, instante);
    // PostgreSQL reavalia o estado esperado após aguardar atualizações concorrentes.
    if (alteracao.count !== 1) transicaoInvalida();
    if (dados.status === "RECUSADO" || dados.status === "CANCELADO") {
      await devolverEstoquePedido(tx, pedido.id_produto, pedido.quantidade);
    }
    await criarHistoricoTransicaoPedido(tx, {
      id_pedido: idPedido, status_anterior: pedido.status_pedido, status_novo: dados.status,
      alterado_por: auth!.id_usuario, motivo: dados.motivo ?? null, created_at: instante,
    });
    return { dados: { id_pedido: idPedido, status_pedido: dados.status, ultima_atualizacao: instante.toISOString() } };
  }, { isolationLevel: "ReadCommitted" });
}

export async function listarMeusPedidos(
  auth: ContextoAutenticado | undefined, filtros: ListarMeusPedidosQuery,
): Promise<MeusPedidos> {
  if (!auth) throw new ErroDominio("UNAUTHENTICATED", 401, "Autenticação necessária.");
  return prisma.$transaction(async (tx) => {
    if (!await buscarPerfilParaHistoricoPedidos(tx, auth.id_usuario)) {
      throw new ErroDominio("CONDOMINO_PROFILE_REQUIRED", 403, "Um perfil de condômino é necessário para consultar pedidos próprios.");
    }
    const vinculos = await buscarVinculosDoHistoricoPedidos(tx, auth.id_usuario);
    const idsVinculos = vinculos.map((vinculo) => vinculo.id_vinculo);
    const meusVinculos = new Set(idsVinculos);
    const { pedidos, total } = idsVinculos.length > 0
      ? await listarPedidosDosVinculos(tx, idsVinculos, {
        papel: filtros.papel, status: filtros.status, limite: filtros.limite,
        deslocamento: (filtros.pagina - 1) * filtros.limite,
      })
      : { pedidos: [], total: 0 };
    return {
      dados: pedidos.map((pedido) => {
        const compra = meusVinculos.has(pedido.id_vinculo_comprador);
        const contraparte = compra ? pedido.produto.vinculo_condominio : pedido.vinculo_condominio;
        if (!pedido.conversa) console.warn({ evento: "ORDER_CHAT_UNAVAILABLE", id_pedido: pedido.id_pedido });
        return {
          id_pedido: pedido.id_pedido, papel_usuario: compra ? "COMPRADOR" : "VENDEDOR",
          quantidade: pedido.quantidade, valor_pedido: pedido.valor_pedido.toFixed(2), status_pedido: pedido.status_pedido,
          hora_solicitacao: pedido.hora_solicitacao.toISOString(), hora_combinada: pedido.hora_combinada.toISOString(),
          ultima_atualizacao: pedido.ultima_atualizacao.toISOString(),
          produto: { id_produto: pedido.produto.id_produto, nome_produto: pedido.produto.nome_produto },
          contraparte: { nome_completo: contraparte.condomino.nome_completo, moradia: contraparte.moradia },
          condominio: pedido.vinculo_condominio.condominio,
          historico: pedido.pedido_status_historico.map((item) => ({
            status_anterior: item.status_anterior, status_novo: item.status_novo, motivo: item.motivo, created_at: item.created_at.toISOString(),
          })),
          chat: { disponivel: pedido.conversa !== null, status_conversa: pedido.conversa?.status_conversa ?? null },
        };
      }),
      paginacao: { pagina: filtros.pagina, limite: filtros.limite, total, total_paginas: Math.ceil(total / filtros.limite) },
    };
  }, { isolationLevel: "RepeatableRead" });
}

type ProdutoParaPedido = Awaited<ReturnType<typeof buscarProdutoParaPedido>>;
type VinculoParaPedido = NonNullable<Awaited<ReturnType<typeof buscarVinculoBloqueadoParaPedido>>>;
const valorMaximoPedido = new Prisma.Decimal("9999999999.99");

function validarProdutoParaPedido(produto: ProdutoParaPedido, comprador: VinculoParaPedido) {
  if (!produto) throw new ErroDominio("PRODUCT_NOT_FOUND", 404, "Produto não encontrado.");
  if (produto.vinculo_condominio.id_condominio !== comprador.id_condominio) {
    throw new ErroDominio("FORBIDDEN_CROSS_TENANT", 403, "Acesso restrito ao próprio condomínio.");
  }
  if (produto.id_vinculo_vendedor === comprador.id_vinculo) {
    throw new ErroDominio("CANNOT_BUY_OWN_PRODUCT", 409, "Não é possível comprar o próprio produto.");
  }
  if (!produto.ativo || produto.vinculo_condominio.status_vinculo !== "ATIVO") {
    throw new ErroDominio("PRODUCT_UNAVAILABLE", 409, "Produto indisponível.");
  }
  return produto;
}

export async function criarPedido(auth: ContextoAutenticado | undefined, dados: CriarPedidoBody): Promise<ResultadoCriacaoPedido> {
  const vinculo = obterVinculoAtivo(auth);
  const idUsuario = auth!.id_usuario;
  const horaSolicitacao = new Date();
  if (dados.hora_combinada < horaSolicitacao) {
    throw new ErroDominio("INVALID_SCHEDULE_TIME", 422, "O horário combinado deve ser igual ou posterior à solicitação.");
  }

  return prisma.$transaction(async (tx) => {
    const comprador = await buscarVinculoBloqueadoParaPedido(tx, vinculo.id_vinculo);
    if (!comprador || comprador.status_vinculo !== "ATIVO" || comprador.id_condomino !== idUsuario) {
      throw new ErroDominio("MEMBERSHIP_REQUIRED", 403, "Um vínculo ativo é necessário para criar pedidos.");
    }
    const inicial = validarProdutoParaPedido(await buscarProdutoParaPedido(tx, dados.id_produto), comprador);
    const vendedor = await buscarVinculoBloqueadoParaPedido(tx, inicial.id_vinculo_vendedor);
    if (!vendedor) {
      throw new ErroDominio("PRODUCT_UNAVAILABLE", 409, "Produto indisponível.");
    }
    validarProdutoParaPedido({ ...inicial, vinculo_condominio: vendedor }, comprador);

    const reserva = await reservarEstoquePedido(tx, inicial.id_produto, vendedor.id_vinculo, dados.quantidade);
    // Em ReadCommitted o UPDATE condicional reavalia estoque após esperar outra reserva.
    const atual = validarProdutoParaPedido(await buscarProdutoParaPedido(tx, dados.id_produto), comprador);
    if (atual.id_vinculo_vendedor !== vendedor.id_vinculo) {
      throw new ErroDominio("PRODUCT_UNAVAILABLE", 409, "Produto indisponível.");
    }
    if (reserva.count !== 1) throw new ErroDominio("INSUFFICIENT_STOCK", 409, "Estoque insuficiente.");

    // O UPDATE mantém a linha do produto bloqueada até o commit. Este é o preço após a reserva.
    const valorPedido = atual.preco.mul(dados.quantidade);
    if (valorPedido.gt(valorMaximoPedido)) {
      throw new ErroDominio("ORDER_VALUE_OUT_OF_RANGE", 422, "O valor do pedido excede o intervalo suportado.");
    }
    const pedido = await inserirPedido(tx, {
      id_produto: atual.id_produto, id_vinculo_comprador: comprador.id_vinculo, quantidade: dados.quantidade,
      valor_pedido: valorPedido, hora_solicitacao: horaSolicitacao, hora_combinada: dados.hora_combinada, ultima_atualizacao: horaSolicitacao,
    });
    await criarHistoricoInicialPedido(tx, pedido.id_pedido, idUsuario, horaSolicitacao);
    const conversa = await criarConversaDoPedido(tx, pedido.id_pedido, horaSolicitacao);
    await criarParticipantesDoPedido(tx, conversa.id_conversa, comprador.id_condomino, vendedor.id_condomino, horaSolicitacao);
    return { dados: {
      id_pedido: pedido.id_pedido, id_produto: pedido.id_produto, quantidade: pedido.quantidade,
      valor_pedido: pedido.valor_pedido.toFixed(2), status_pedido: pedido.status_pedido,
      hora_solicitacao: pedido.hora_solicitacao.toISOString(), hora_combinada: pedido.hora_combinada.toISOString(),
      ultima_atualizacao: pedido.ultima_atualizacao.toISOString(), produto: pedido.produto,
    } };
  }, { isolationLevel: "ReadCommitted" });
}
