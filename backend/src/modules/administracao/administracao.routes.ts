import { Router } from "express";
import { autenticar } from "../../middlewares/autenticar.js";
import { exigirAdmin, exigirSuperAdmin } from "../../middlewares/autorizar.js";
import { validarBody, validarParams, validarQuery, validarSemBody } from "../../middlewares/validar.js";
import { aprovarVinculoController, listarVinculosPendentesController, rejeitarVinculoController, suspenderVinculoController } from "../vinculos/vinculo.controller.js";
import { decisaoVinculoParamsSchema, listarVinculosPendentesQuerySchema } from "../vinculos/vinculo.schema.js";
import { atualizarStatusContaBodySchema } from "../usuarios/usuario.schema.js";
import { atualizarAdminVinculoBodySchema, listarVinculosQuerySchema } from "./administracao.schema.js";
import { alterarAdminVinculoController, alterarStatusContaController, criarCondominioAdminController, listarVinculosAdminController } from "./administracao.controller.js";
import { criarCondominioBodySchema } from "../condominios/condominio.schema.js";

export const administracaoRoutes = Router();

administracaoRoutes.post("/condominios", autenticar, exigirSuperAdmin(), validarBody(criarCondominioBodySchema), criarCondominioAdminController);

administracaoRoutes.get("/vinculos", autenticar, exigirAdmin(), validarSemBody, validarQuery(listarVinculosQuerySchema), listarVinculosAdminController);
administracaoRoutes.patch("/vinculos/:id/admin", autenticar, exigirAdmin(), validarParams(decisaoVinculoParamsSchema), validarBody(atualizarAdminVinculoBodySchema), alterarAdminVinculoController);
administracaoRoutes.patch("/usuarios/:id/status", autenticar, exigirSuperAdmin(), validarParams(decisaoVinculoParamsSchema), validarBody(atualizarStatusContaBodySchema), alterarStatusContaController);

administracaoRoutes.get(
  "/vinculos/pendentes",
  autenticar,
  exigirAdmin(),
  validarQuery(listarVinculosPendentesQuerySchema),
  listarVinculosPendentesController,
);

administracaoRoutes.patch(
  "/vinculos/:id/aprovar",
  autenticar,
  exigirAdmin(),
  validarParams(decisaoVinculoParamsSchema),
  validarSemBody,
  aprovarVinculoController,
);

administracaoRoutes.patch(
  "/vinculos/:id/rejeitar",
  autenticar,
  exigirAdmin(),
  validarParams(decisaoVinculoParamsSchema),
  validarSemBody,
  rejeitarVinculoController,
);

administracaoRoutes.patch(
  "/vinculos/:id/suspender",
  autenticar,
  exigirAdmin(),
  validarParams(decisaoVinculoParamsSchema),
  validarSemBody,
  suspenderVinculoController,
);
