import type { Request, Response } from "express";
import { alterarCondominioAdmin, listarCondominiosAdmin, obterCondominioAdmin } from "./condominio-admin.service.js";
import type { EditarCondominioBody, ListarCondominiosAdminQuery, StatusCondominioBody } from "./condominio.schema.js";

export async function listarCondominiosAdminController(req: Request, res: Response<unknown, { queryValidada: ListarCondominiosAdminQuery }>) {
  res.status(200).json(await listarCondominiosAdmin(req.auth, res.locals.queryValidada));
}
export async function obterCondominioAdminController(req: Request, res: Response<unknown, { paramsValidados: { id: string } }>) {
  res.status(200).json(await obterCondominioAdmin(req.auth, res.locals.paramsValidados.id));
}
export async function editarCondominioAdminController(req: Request<Record<string, string>, unknown, EditarCondominioBody>, res: Response<unknown, { paramsValidados: { id: string } }>) {
  res.status(200).json(await alterarCondominioAdmin(req.auth, res.locals.paramsValidados.id, req.body));
}
export async function statusCondominioAdminController(req: Request<Record<string, string>, unknown, StatusCondominioBody>, res: Response<unknown, { paramsValidados: { id: string } }>) {
  res.status(200).json(await alterarCondominioAdmin(req.auth, res.locals.paramsValidados.id, req.body));
}
