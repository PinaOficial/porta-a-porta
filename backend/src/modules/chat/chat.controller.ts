import type { Request, Response } from "express";
import type { PedidoParams } from "../pedidos/pedido.schema.js";
import type { CriarMensagemBody, ListarMensagensQuery } from "./chat.schema.js";
import { enviarMensagemDoPedido, listarChatDoPedido } from "./chat.service.js";
import type { MensagemDto, MensagensDoPedido } from "./chat.model.js";

export async function listarChatDoPedidoController(
  req: Request, res: Response<MensagensDoPedido, { paramsValidados: PedidoParams; queryValidada: ListarMensagensQuery }>,
): Promise<void> {
  res.status(200).json(await listarChatDoPedido(req.auth, res.locals.paramsValidados.id, res.locals.queryValidada));
}

export async function enviarMensagemDoPedidoController(
  req: Request<Record<string, string>, { dados: MensagemDto }, CriarMensagemBody>,
  res: Response<{ dados: MensagemDto }, { paramsValidados: PedidoParams }>,
): Promise<void> {
  res.status(201).json(await enviarMensagemDoPedido(req.auth, res.locals.paramsValidados.id, req.body));
}
