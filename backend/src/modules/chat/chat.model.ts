import type { status_conversa_enum, status_pedido_enum } from "../../generated/prisma/client.js";
import type { MeusPedidos } from "../pedidos/pedido.model.js";

export interface MensagemDto {
  id_mensagem: string;
  conteudo: string;
  created_at: string;
  remetente: { nome_completo: string; papel: "COMPRADOR" | "VENDEDOR" | null };
}

export interface MensagensDoPedido {
  dados: MensagemDto[];
  paginacao: MeusPedidos["paginacao"];
  conversa: { id_conversa: string; status_conversa: status_conversa_enum };
  pedido: { id_pedido: string; status_pedido: status_pedido_enum };
}
