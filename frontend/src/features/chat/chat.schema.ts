import { z } from "zod";
import { paginaHistoricoSchema } from "../pedidos/pedido.schema";
export const mensagemChatSchema = z.strictObject({ conteudo: z.string().trim().min(1, "Escreva uma mensagem.").max(1000, "Use até 1000 caracteres.") });
export const paginaChatSchema = paginaHistoricoSchema(50);
export const contextoChatSchema = z.object({ id_pedido: z.uuid(), id_usuario: z.uuid(), papel_usuario: z.enum(["COMPRADOR", "VENDEDOR"]) });
