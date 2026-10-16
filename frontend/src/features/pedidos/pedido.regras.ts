import type { DestinoPedido, PapelPedido, StatusPedido } from "./pedido.types";
export const nomesStatusPedido: Record<StatusPedido, string> = {
  SOLICITADO: "Solicitado", ACEITO: "Aceito", RECUSADO: "Recusado", CANCELADO: "Cancelado", CONCLUIDO: "Concluído",
};
export const nomesAcaoPedido: Record<DestinoPedido, string> = { ACEITO: "Aceitar", RECUSADO: "Recusar", CANCELADO: "Cancelar", CONCLUIDO: "Concluir" };
export function acoesPermitidasPedido(papel: PapelPedido, status: StatusPedido): DestinoPedido[] {
  if (papel === "COMPRADOR" && (status === "SOLICITADO" || status === "ACEITO")) return ["CANCELADO"];
  if (papel === "VENDEDOR" && status === "SOLICITADO") return ["ACEITO", "RECUSADO"];
  if (papel === "VENDEDOR" && status === "ACEITO") return ["CONCLUIDO"];
  return [];
}
