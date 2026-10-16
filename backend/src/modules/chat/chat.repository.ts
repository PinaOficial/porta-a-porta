import type { Prisma, conversa } from "../../generated/prisma/client.js";

export function criarConversaDoPedido(tx: Prisma.TransactionClient, idPedido: string, instante: Date) {
  return tx.conversa.create({
    data: { id_pedido: idPedido, status_conversa: "ATIVA", created_at: instante },
    select: { id_conversa: true },
  });
}

export function criarParticipantesDoPedido(
  tx: Prisma.TransactionClient, idConversa: string, idComprador: string, idVendedor: string, instante: Date,
) {
  return tx.conversa_participante.createMany({ data: [
    { id_conversa: idConversa, id_usuario: idComprador, joined_at: instante },
    { id_conversa: idConversa, id_usuario: idVendedor, joined_at: instante },
  ] });
}

export function buscarConversaDoPedido(tx: Prisma.TransactionClient, idPedido: string) {
  return tx.conversa.findUnique({ where: { id_pedido: idPedido }, select: { id_conversa: true, status_conversa: true } });
}

export async function buscarConversaBloqueadaDoPedido(tx: Prisma.TransactionClient, idPedido: string) {
  // Impede encerrar a conversa entre a validação de ATIVA e o INSERT da mensagem.
  const conversas = await tx.$queryRaw<Pick<conversa, "id_conversa" | "status_conversa">[]>`
    SELECT id_conversa, status_conversa FROM public.conversa
    WHERE id_pedido = ${idPedido}::uuid FOR SHARE
  `;
  return conversas[0] ?? null;
}

const camposMensagem = {
  id_mensagem: true, conteudo: true, created_at: true, id_remetente: true,
  usuario: { select: { condomino: { select: { nome_completo: true } } } },
} satisfies Prisma.mensagemSelect;

export function inserirMensagem(tx: Prisma.TransactionClient, idConversa: string, idRemetente: string, conteudo: string) {
  return tx.mensagem.create({
    data: { id_conversa: idConversa, id_remetente: idRemetente, conteudo },
    select: camposMensagem,
  });
}

export async function listarMensagensDaConversa(tx: Prisma.TransactionClient, idConversa: string, deslocamento: number, limite: number) {
  const where = { id_conversa: idConversa };
  const mensagens = await tx.mensagem.findMany({
    where, select: camposMensagem, orderBy: [{ created_at: "asc" }, { id_mensagem: "asc" }], skip: deslocamento, take: limite,
  });
  const total = await tx.mensagem.count({ where });
  return { mensagens, total };
}
