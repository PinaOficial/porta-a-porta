import { Router } from "express";
import { autenticar } from "../../middlewares/autenticar.js";
import { exigirVinculoAtivo } from "../../middlewares/autorizar.js";
import { validarBody, validarParams, validarQuery, validarSemBody } from "../../middlewares/validar.js";
import { atualizarStatusPedidoBodySchema, criarPedidoBodySchema, listarMeusPedidosQuerySchema, pedidoParamsSchema } from "./pedido.schema.js";
import { atualizarStatusPedidoController, criarPedidoController, listarMeusPedidosController } from "./pedido.controller.js";
import { chatRoutes } from "../chat/chat.routes.js";

export const pedidoRoutes = Router();
pedidoRoutes.get("/me", autenticar, validarSemBody, validarQuery(listarMeusPedidosQuerySchema), listarMeusPedidosController);
pedidoRoutes.post("/", autenticar, exigirVinculoAtivo(), validarBody(criarPedidoBodySchema), criarPedidoController);
pedidoRoutes.patch("/:id/status", autenticar, validarParams(pedidoParamsSchema), validarBody(atualizarStatusPedidoBodySchema), atualizarStatusPedidoController);
pedidoRoutes.use("/:id/chat", chatRoutes);
