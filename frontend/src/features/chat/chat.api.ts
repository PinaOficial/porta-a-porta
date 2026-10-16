import { apiFetch, type Objeto } from "../../lib/api";
import { mensagemChatSchema } from "./chat.schema";
import type { ChatPedido, MensagemChat } from "./chat.types";
export const consultarChatPedido = (id: string, pagina: number, signal?: AbortSignal) =>
  apiFetch<ChatPedido>(`/pedidos/${encodeURIComponent(id)}/chat?${new URLSearchParams({ pagina: String(pagina), limite: "50" })}`, { signal });
export const enviarMensagemPedido = (id: string, conteudo: string) =>
  apiFetch<Objeto<MensagemChat>>(`/pedidos/${encodeURIComponent(id)}/chat/messages`, { method: "POST", json: mensagemChatSchema.parse({ conteudo }) });
