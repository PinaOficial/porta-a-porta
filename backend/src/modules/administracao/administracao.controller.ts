import type { Request, Response } from "express";
import type { DecisaoVinculoParams } from "../vinculos/vinculo.schema.js";
import type { AtualizarStatusContaBody } from "../usuarios/usuario.schema.js";
import type { ResultadoStatusConta } from "../usuarios/usuario.model.js";
import { alterarStatusConta } from "../usuarios/usuario.service.js";
import { alterarAdminVinculo, cadastrarCondominioAdmin, listarVinculosAdmin } from "./administracao.service.js";
import type { CriarCondominioBody } from "../condominios/condominio.schema.js";
import type { ResultadoCriacaoCondominio } from "../condominios/condominio.model.js";
import type { AtualizarAdminVinculoBody, ListarVinculosQuery } from "./administracao.schema.js";
import type { ListaVinculosAdministrativos, ResultadoAdminVinculo } from "./administracao.model.js";

export async function criarCondominioAdminController(
  req: Request<Record<string, string>, ResultadoCriacaoCondominio, CriarCondominioBody>,
  res: Response<ResultadoCriacaoCondominio>,
): Promise<void> {
  res.status(201).json(await cadastrarCondominioAdmin(req.auth, req.body));
}

export async function listarVinculosAdminController(req: Request, res: Response<ListaVinculosAdministrativos, { queryValidada: ListarVinculosQuery }>): Promise<void> {
  res.status(200).json(await listarVinculosAdmin(req.auth, res.locals.queryValidada));
}
export async function alterarAdminVinculoController(
  req: Request<Record<string, string>, ResultadoAdminVinculo, AtualizarAdminVinculoBody>,
  res: Response<ResultadoAdminVinculo, { paramsValidados: DecisaoVinculoParams }>,
): Promise<void> {
  res.status(200).json(await alterarAdminVinculo(req.auth, res.locals.paramsValidados.id, req.body));
}
export async function alterarStatusContaController(
  req: Request<Record<string, string>, ResultadoStatusConta, AtualizarStatusContaBody>, res: Response<ResultadoStatusConta, { paramsValidados: DecisaoVinculoParams }>,
): Promise<void> {
  res.status(200).json(await alterarStatusConta(req.auth, res.locals.paramsValidados.id, req.body));
}
