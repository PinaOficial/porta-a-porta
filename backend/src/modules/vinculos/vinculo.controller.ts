import type { Request, Response } from "express";
import type { ListaVinculosPendentes, ResultadoAprovacaoVinculo, ResultadoRejeicaoVinculo, ResultadoSuspensaoVinculo, SituacaoResidencial } from "./vinculo.model.js";
import type { DecisaoVinculoParams, ListarVinculosPendentesQuery } from "./vinculo.schema.js";
import { aprovarVinculo, consultarMinhaSituacaoResidencial, listarVinculosPendentes, rejeitarVinculo, suspenderVinculo } from "./vinculo.service.js";
import { solicitarTransferencia } from "./vinculo.service.js";
import type { SolicitarTransferenciaBody } from "./vinculo.schema.js";
import type { ResultadoSolicitacaoTransferencia } from "./vinculo.model.js";

export async function solicitarTransferenciaController(
  req: Request<Record<string, never>, ResultadoSolicitacaoTransferencia, SolicitarTransferenciaBody>, res: Response<ResultadoSolicitacaoTransferencia>,
): Promise<void> {
  res.status(201).json(await solicitarTransferencia(req.auth, req.body));
}

export async function suspenderVinculoController(
  req: Request,
  res: Response<ResultadoSuspensaoVinculo, { paramsValidados: DecisaoVinculoParams }>,
): Promise<void> {
  const resultado = await suspenderVinculo(req.auth, res.locals.paramsValidados.id);
  res.status(200).json(resultado);
}

export async function rejeitarVinculoController(
  req: Request,
  res: Response<ResultadoRejeicaoVinculo, { paramsValidados: DecisaoVinculoParams }>,
): Promise<void> {
  const resultado = await rejeitarVinculo(req.auth, res.locals.paramsValidados.id);
  res.status(200).json(resultado);
}

export async function aprovarVinculoController(
  req: Request,
  res: Response<ResultadoAprovacaoVinculo, { paramsValidados: DecisaoVinculoParams }>,
): Promise<void> {
  const resultado = await aprovarVinculo(req.auth, res.locals.paramsValidados.id);
  res.status(200).json(resultado);
}

export async function listarVinculosPendentesController(
  req: Request,
  res: Response<ListaVinculosPendentes, { queryValidada: ListarVinculosPendentesQuery }>,
): Promise<void> {
  const resultado = await listarVinculosPendentes(req.auth, res.locals.queryValidada);
  res.status(200).json(resultado);
}

export async function consultarMeuVinculoController(req: Request, res: Response<SituacaoResidencial>): Promise<void> {
  const situacao = await consultarMinhaSituacaoResidencial(req.auth);
  res.status(200).json(situacao);
}
