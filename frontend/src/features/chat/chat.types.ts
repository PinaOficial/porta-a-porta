import type { ListaPaginada } from "../../lib/api";
import type { PapelPedido, StatusConversa, StatusPedido } from "../pedidos/pedido.types";
export interface MensagemChat {
  id_mensagem: string;
  conteudo: string;
  created_at: string;
  remetente: { nome_completo: string; papel: PapelPedido | null };
}
export interface ChatPedido extends ListaPaginada<MensagemChat> {
  conversa: { id_conversa: string; status_conversa: StatusConversa };
  pedido: { id_pedido: string; status_pedido: StatusPedido };
}
