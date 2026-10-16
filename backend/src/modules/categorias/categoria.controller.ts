import type { Request, Response } from "express";
import type { CategoriasVitrine } from "./categoria.model.js";
import { listarCategoriasDaVitrine } from "./categoria.service.js";

export async function listarCategoriasController(req: Request, res: Response<CategoriasVitrine>): Promise<void> {
  const categorias = await listarCategoriasDaVitrine(req.auth);
  res.status(200).json(categorias);
}
