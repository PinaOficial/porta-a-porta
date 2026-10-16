import { Router } from "express";
import { autenticar } from "../../middlewares/autenticar.js";
import { validarQuery } from "../../middlewares/validar.js";
import { listarCondominiosController } from "./condominio.controller.js";
import { listarCondominiosQuerySchema } from "./condominio.schema.js";

export const condominioRoutes = Router();

condominioRoutes.get("/", autenticar, validarQuery(listarCondominiosQuerySchema), listarCondominiosController);
