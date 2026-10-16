import type { Request, Response } from "express";
import { consultarMeuUsuario } from "./usuario.service.js";
import type { MeuUsuario } from "./usuario.model.js";

export async function consultarMeuUsuarioController(req: Request, res: Response<MeuUsuario>): Promise<void> {
  res.status(200).json(await consultarMeuUsuario(req.auth));
}
import type { OnboardingBody } from "./usuario.schema.js";
import type { ResultadoOnboarding } from "./usuario.model.js";
import { realizarOnboarding } from "./usuario.service.js";

export async function realizarOnboardingController(
  req: Request<Record<string, never>, ResultadoOnboarding, OnboardingBody>,
  res: Response<ResultadoOnboarding>,
): Promise<void> {
  const resultado = await realizarOnboarding(req.auth, req.body);
  res.status(201).json(resultado);
}
