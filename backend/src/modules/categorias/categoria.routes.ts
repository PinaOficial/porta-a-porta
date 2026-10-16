import { Router } from "express";
import { autenticar } from "../../middlewares/autenticar.js";
import { listarCategoriasController } from "./categoria.controller.js";

export const categoriaRoutes = Router();

categoriaRoutes.get("/", autenticar, listarCategoriasController);
