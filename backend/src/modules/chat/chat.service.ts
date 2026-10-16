import { prisma } from "../../lib/prisma.js";
import { ErroDominio } from "../../lib/erro-dominio.js";
import type { ContextoAutenticado } from "../../types/auth.js";
import { obterPedidoDaNegociacao } from "../pedidos/pedido.service.js";
import { buscarConversaBloqueadaDoPedido, buscarConversaDoPedido, inserirMensagem, listarMensagensDaConversa } from "./chat.repository.js";
import type { CriarMensagemBody, ListarMensagensQuery } from "./chat.schema.js";
import type { MensagemDto, MensagensDoPedido } from "./chat.model.js";

type Pedido = Awaited<ReturnType<typeof obterPedidoDaNegociacao>>["pedido"];
type Mensagem = Awaited<ReturnType<typeof inserirMensagem>>;

function mensagemDto(mensagem: Mensagem, pedido: Pedido): MensagemDto {
  return {
    id_mensagem: mensagem.id_mensagem, conteudo: mensagem.conteudo, created_at: mensagem.created_at.toISOString(),
    remetente: {
      nome_completo: mensagem.usuario.condomino?.nome_completo ?? "Usuário",
      papel: mensagem.id_remetente === pedido.vinculo_condominio.id_condomino ? "COMPRADOR"
        : mensagem.id_remetente === pedido.produto.vinculo_condominio.id_condomino ? "VENDEDOR" : null,
    },
  };
}

function chatNaoEncontrado(): never {
  throw new ErroDominio("CHAT_NOT_FOUND", 404, "Conversa do pedido não encontrada.");
}

export async function listarChatDoPedido(
  auth: ContextoAutenticado | undefined, idPedido: string, filtros: ListarMensagensQuery,
): Promise<MensagensDoPedido> {
  return prisma.$transaction(async (tx) => {
    const { pedido } = await obterPedidoDaNegociacao(tx, idPedido, auth, true);
    const conversa = await buscarConversaDoPedido(tx, idPedido);
    if (!conversa) chatNaoEncontrado();
    const { mensagens, total } = await listarMensagensDaConversa(tx, conversa.id_conversa, (filtros.pagina - 1) * filtros.limite, filtros.limite);
    return {
      dados: mensagens.map((mensagem) => mensagemDto(mensagem, pedido)),
      paginacao: { pagina: filtros.pagina, limite: filtros.limite, total, total_paginas: Math.ceil(total / filtros.limite) },
      conversa, pedido: { id_pedido: pedido.id_pedido, status_pedido: pedido.status_pedido },
    };
  }, { isolationLevel: "RepeatableRead" });
}

export async function enviarMensagemDoPedido(
  auth: ContextoAutenticado | undefined, idPedido: string, dados: CriarMensagemBody,
): Promise<{ dados: MensagemDto }> {
  return prisma.$transaction(async (tx) => {
    // Super admin pode ler como observador, mas somente as partes podem enviar.
    const { pedido, comprador, vendedor } = await obterPedidoDaNegociacao(tx, idPedido, auth, true);
    if (!comprador && !vendedor) throw new ErroDominio("CHAT_SEND_FORBIDDEN", 403, "Somente comprador e vendedor podem enviar mensagens.");
    const conversa = await buscarConversaBloqueadaDoPedido(tx, idPedido);
    if (!conversa) chatNaoEncontrado();
    if (conversa.status_conversa !== "ATIVA") throw new ErroDominio("CHAT_CLOSED", 409, "Conversa encerrada.");
    return { dados: mensagemDto(await inserirMensagem(tx, conversa.id_conversa, auth!.id_usuario, dados.conteudo), pedido) };
  }, { isolationLevel: "ReadCommitted" });
}
