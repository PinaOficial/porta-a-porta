import { Router } from "express";
import { autenticar } from "../../middlewares/autenticar.js";
import { validarBody, validarParams, validarQuery, validarSemBody } from "../../middlewares/validar.js";
import { pedidoParamsSchema } from "../pedidos/pedido.schema.js";
import { criarMensagemBodySchema, listarMensagensQuerySchema } from "./chat.schema.js";
import { enviarMensagemDoPedidoController, listarChatDoPedidoController } from "./chat.controller.js";

export const chatRoutes = Router({ mergeParams: true });
chatRoutes.get("/", autenticar, validarParams(pedidoParamsSchema), validarSemBody, validarQuery(listarMensagensQuerySchema), listarChatDoPedidoController);
chatRoutes.post("/messages", autenticar, validarParams(pedidoParamsSchema), validarBody(criarMensagemBodySchema), enviarMensagemDoPedidoController);
