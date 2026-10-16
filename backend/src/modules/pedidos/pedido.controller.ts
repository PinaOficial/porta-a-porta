import type { Request, Response } from "express";
import type { AtualizarStatusPedidoBody, CriarPedidoBody, ListarMeusPedidosQuery, PedidoParams } from "./pedido.schema.js";
import type { MeusPedidos, ResultadoCriacaoPedido, ResultadoStatusPedido } from "./pedido.model.js";
import { atualizarStatusPedido, criarPedido, listarMeusPedidos } from "./pedido.service.js";

export async function atualizarStatusPedidoController(
  req: Request<Record<string, string>, ResultadoStatusPedido, AtualizarStatusPedidoBody>,
  res: Response<ResultadoStatusPedido, { paramsValidados: PedidoParams }>,
): Promise<void> {
  res.status(200).json(await atualizarStatusPedido(req.auth, res.locals.paramsValidados.id, req.body));
}

export async function listarMeusPedidosController(
  req: Request, res: Response<MeusPedidos, { queryValidada: ListarMeusPedidosQuery }>,
): Promise<void> {
  res.status(200).json(await listarMeusPedidos(req.auth, res.locals.queryValidada));
}

export async function criarPedidoController(
  req: Request<Record<string, never>, ResultadoCriacaoPedido, CriarPedidoBody>, res: Response<ResultadoCriacaoPedido>,
): Promise<void> {
  res.status(201).json(await criarPedido(req.auth, req.body));
}
