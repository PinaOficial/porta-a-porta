import { apiFetch, type ListaPaginada, type Objeto } from "../../lib/api";
import type { CriarPedido, DestinoPedido, MeuPedido, PedidoCriado, ResultadoStatusPedido } from "./pedido.types";
import { alterarStatusPedidoSchema, type FiltrosPedidos } from "./pedido.schema";
export const criarPedido = ({ id_produto, quantidade, hora_combinada }: CriarPedido) =>
  apiFetch<Objeto<PedidoCriado>>("/pedidos", { method: "POST", json: { id_produto, quantidade, hora_combinada } });
export function listarMeusPedidos({ papel, status, pagina, limite = 20 }: FiltrosPedidos & { limite?: number }, signal?: AbortSignal) {
  const query = new URLSearchParams({ pagina: String(pagina), limite: String(limite) });
  if (papel) query.set("papel", papel);
  if (status) query.set("status", status);
  return apiFetch<ListaPaginada<MeuPedido>>(`/pedidos/me?${query}`, { signal });
}
export const alterarStatusPedido = (id: string, dados: { status: DestinoPedido; motivo?: string }) =>
  apiFetch<Objeto<ResultadoStatusPedido>>(`/pedidos/${encodeURIComponent(id)}/status`, { method: "PATCH", json: alterarStatusPedidoSchema.parse(dados) });
