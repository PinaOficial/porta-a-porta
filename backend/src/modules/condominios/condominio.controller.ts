import type { Request, Response } from "express";
import type { ListaCondominios } from "./condominio.model.js";
import type { ListarCondominiosQuery } from "./condominio.schema.js";
import { listarCondominiosDisponiveis } from "./condominio.service.js";

export async function listarCondominiosController(
  req: Request,
  res: Response<ListaCondominios, { queryValidada: ListarCondominiosQuery }>,
): Promise<void> {
  const resultado = await listarCondominiosDisponiveis(req.auth, res.locals.queryValidada);
  res.status(200).json(resultado);
}
