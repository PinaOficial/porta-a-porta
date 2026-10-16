import { Router } from "express";
import { autenticar } from "../../middlewares/autenticar.js";
import { consultarMeuVinculoController, solicitarTransferenciaController } from "./vinculo.controller.js";
import { exigirVinculoAtivo } from "../../middlewares/autorizar.js";
import { validarBody } from "../../middlewares/validar.js";
import { solicitarTransferenciaBodySchema } from "./vinculo.schema.js";

export const vinculoRoutes = Router();

vinculoRoutes.get("/me", autenticar, consultarMeuVinculoController);
vinculoRoutes.post("/transferencia", autenticar, exigirVinculoAtivo(), validarBody(solicitarTransferenciaBodySchema), solicitarTransferenciaController);
