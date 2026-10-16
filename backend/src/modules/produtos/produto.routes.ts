import { Router } from "express";
import { uploadImagemProduto } from "./produto.upload.js";
import { autenticar } from "../../middlewares/autenticar.js";
import { exigirVinculoAtivo } from "../../middlewares/autorizar.js";
import { validarBody, validarParams, validarQuery, validarSemBody } from "../../middlewares/validar.js";
import { adicionarImagemProdutoController, alterarStatusProdutoController, cadastrarProdutoController, editarProdutoController, excluirImagemProdutoController, listarMeusProdutosController, listarProdutosController } from "./produto.controller.js";
import { alterarStatusProdutoBodySchema, criarProdutoBodySchema, editarProdutoBodySchema, excluirImagemProdutoParamsSchema, excluirImagemProdutoQuerySchema, listarMeusProdutosQuerySchema, listarProdutosQuerySchema, produtoParamsSchema } from "./produto.schema.js";
import { detalheProdutoQuerySchema } from "./produto.schema.js";
import { detalharProdutoController } from "./produto.controller.js";

export const produtoRoutes = Router();

produtoRoutes.delete(
  "/:id/imagens/:idImagem", autenticar, exigirVinculoAtivo(), validarParams(excluirImagemProdutoParamsSchema),
  validarSemBody, validarQuery(excluirImagemProdutoQuerySchema), excluirImagemProdutoController,
);

produtoRoutes.post(
  "/:id/imagens", autenticar, exigirVinculoAtivo(), validarParams(produtoParamsSchema),
  uploadImagemProduto, adicionarImagemProdutoController,
);

produtoRoutes.get("/me", autenticar, exigirVinculoAtivo(), validarSemBody, validarQuery(listarMeusProdutosQuerySchema), listarMeusProdutosController);
produtoRoutes.get("/:id", autenticar, validarParams(produtoParamsSchema), validarSemBody, validarQuery(detalheProdutoQuerySchema), detalharProdutoController);
produtoRoutes.get("/", autenticar, validarQuery(listarProdutosQuerySchema), listarProdutosController);
produtoRoutes.post("/", autenticar, exigirVinculoAtivo(), validarBody(criarProdutoBodySchema), cadastrarProdutoController);
produtoRoutes.patch(
  "/:id/status", autenticar, exigirVinculoAtivo(), validarParams(produtoParamsSchema),
  validarBody(alterarStatusProdutoBodySchema), alterarStatusProdutoController,
);
produtoRoutes.patch(
  "/:id", autenticar, exigirVinculoAtivo(), validarParams(produtoParamsSchema),
  validarBody(editarProdutoBodySchema), editarProdutoController,
);
