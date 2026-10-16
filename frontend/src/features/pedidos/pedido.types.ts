export interface CriarPedido {
  id_produto: string;
  quantidade: number;
  hora_combinada: string;
}
export interface PedidoCriado extends CriarPedido {
  id_pedido: string;
  valor_pedido: string;
  status_pedido: "SOLICITADO";
  hora_solicitacao: string;
  ultima_atualizacao: string;
  produto: { id_produto: string; nome_produto: string };
}
export type StatusPedido = "SOLICITADO" | "ACEITO" | "RECUSADO" | "CANCELADO" | "CONCLUIDO";
export type DestinoPedido = Exclude<StatusPedido, "SOLICITADO">;
export type PapelPedido = "COMPRADOR" | "VENDEDOR";
export type StatusConversa = "ATIVA" | "ENCERRADA";
export interface MeuPedido extends Omit<PedidoCriado, "id_produto" | "status_pedido"> {
  status_pedido: StatusPedido;
  papel_usuario: PapelPedido;
  contraparte: { nome_completo: string; moradia: string };
  condominio: { id_condominio: string; nome_residencial: string };
  historico: { status_anterior: StatusPedido | null; status_novo: StatusPedido; motivo: string | null; created_at: string }[];
  chat: { disponivel: boolean; status_conversa: StatusConversa | null };
}
export interface ResultadoStatusPedido { id_pedido: string; status_pedido: StatusPedido; ultima_atualizacao: string }
