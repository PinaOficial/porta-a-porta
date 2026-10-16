import type { Request, Response } from "express";
import type { AlterarStatusProdutoBody, CriarProdutoBody, EditarProdutoBody, ExcluirImagemProdutoParams, ListarMeusProdutosQuery, ListarProdutosQuery, ProdutoParams } from "./produto.schema.js";
import type { MeusProdutos, ResultadoCriacaoProduto, ResultadoEdicaoProduto, ResultadoUploadImagem, VitrineProdutos } from "./produto.model.js";
import { adicionarImagemProduto, alterarStatusProduto, cadastrarProduto, editarProduto, excluirImagemProduto, listarMeusProdutos, listarVitrineProdutos } from "./produto.service.js";
import { detalharProduto } from "./produto.service.js";
import type { DetalheProdutoQuery } from "./produto.schema.js";
import type { ResultadoDetalheProduto } from "./produto.model.js";

export async function detalharProdutoController(req: Request, res: Response<ResultadoDetalheProduto, { paramsValidados: ProdutoParams; queryValidada: DetalheProdutoQuery }>): Promise<void> {
  res.status(200).json(await detalharProduto(req.auth, res.locals.paramsValidados.id, res.locals.queryValidada));
}

export async function excluirImagemProdutoController(
  req: Request,
  res: Response<void, { paramsValidados: ExcluirImagemProdutoParams }>,
): Promise<void> {
  const { id, idImagem } = res.locals.paramsValidados;
  await excluirImagemProduto(req.auth, id, idImagem);
  res.status(204).end();
}

export async function adicionarImagemProdutoController(
  req: Request,
  res: Response<ResultadoUploadImagem, { paramsValidados: ProdutoParams }>,
): Promise<void> {
  const resultado = await adicionarImagemProduto(req.auth, res.locals.paramsValidados.id, req.file);
  res.status(201).json(resultado);
}

export async function alterarStatusProdutoController(
  req: Request<ProdutoParams, ResultadoEdicaoProduto, AlterarStatusProdutoBody>,
  res: Response<ResultadoEdicaoProduto, { paramsValidados: ProdutoParams }>,
): Promise<void> {
  const resultado = await alterarStatusProduto(req.auth, res.locals.paramsValidados.id, req.body.ativo);
  res.status(200).json(resultado);
}

export async function editarProdutoController(
  req: Request<ProdutoParams, ResultadoEdicaoProduto, EditarProdutoBody>,
  res: Response<ResultadoEdicaoProduto, { paramsValidados: ProdutoParams }>,
): Promise<void> {
  const resultado = await editarProduto(req.auth, res.locals.paramsValidados.id, req.body);
  res.status(200).json(resultado);
}

export async function listarMeusProdutosController(
  req: Request,
  res: Response<MeusProdutos, { queryValidada: ListarMeusProdutosQuery }>,
): Promise<void> {
  const produtos = await listarMeusProdutos(req.auth, res.locals.queryValidada);
  res.status(200).json(produtos);
}

export async function cadastrarProdutoController(
  req: Request<Record<string, never>, ResultadoCriacaoProduto, CriarProdutoBody>,
  res: Response<ResultadoCriacaoProduto>,
): Promise<void> {
  const resultado = await cadastrarProduto(req.auth, req.body);
  res.status(201).json(resultado);
}

export async function listarProdutosController(
  req: Request,
  res: Response<VitrineProdutos, { queryValidada: ListarProdutosQuery }>,
): Promise<void> {
  const vitrine = await listarVitrineProdutos(req.auth, res.locals.queryValidada);
  res.status(200).json(vitrine);
}
