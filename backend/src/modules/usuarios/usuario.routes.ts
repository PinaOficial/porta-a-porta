import { Router } from "express";
import { autenticar } from "../../middlewares/autenticar.js";
import { validarBody, validarQuery, validarSemBody } from "../../middlewares/validar.js";
import { onboardingBodySchema } from "./usuario.schema.js";
import { realizarOnboardingController } from "./usuario.controller.js";
import { consultarMeuUsuarioQuerySchema } from "./usuario.schema.js";
import { consultarMeuUsuarioController } from "./usuario.controller.js";

export const usuarioRoutes = Router();

usuarioRoutes.post("/onboarding", autenticar, validarBody(onboardingBodySchema), realizarOnboardingController);
usuarioRoutes.get("/usuarios/me", autenticar, validarSemBody, validarQuery(consultarMeuUsuarioQuerySchema), consultarMeuUsuarioController);
