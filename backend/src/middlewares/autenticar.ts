import type { RequestHandler } from "express";
import { createRemoteJWKSet, errors, jwtVerify } from "jose";
import { z } from "zod";
import { env } from "../config/env.js";
import { ErroDominio } from "../lib/erro-dominio.js";
import { buscarUsuarioParaAutenticacao } from "../modules/usuarios/usuario.repository.js";
import { buscarVinculoAtivoDoUsuario } from "../modules/vinculos/vinculo.repository.js";

const issuer = `${env.SUPABASE_URL.replace(/\/$/, "")}/auth/v1`;
const jwks = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`));
const idUsuarioSchema = z.uuid();
const emailAutenticadoSchema = z.string().trim().toLowerCase().pipe(z.email().max(320));

export const autenticar: RequestHandler = async (req, _res, next) => {
  try {
    const token = /^Bearer ([^\s]+)$/i.exec(req.headers.authorization ?? "")?.[1];
    if (!token) {
      throw new ErroDominio("UNAUTHENTICATED", 401, "Bearer token necessário.");
    }

    const { payload } = await jwtVerify(token, jwks, {
      issuer,
      audience: "authenticated",
      algorithms: ["ES256", "RS256"],
      requiredClaims: ["sub", "exp", "iss", "aud"],
    });

    const idUsuario = idUsuarioSchema.safeParse(payload.sub);
    if (!idUsuario.success) {
      throw new ErroDominio("UNAUTHENTICATED", 401, "Identidade inválida.");
    }

    const email = emailAutenticadoSchema.safeParse(payload.email);
    const usuario = await buscarUsuarioParaAutenticacao(idUsuario.data);
    if (usuario?.status_conta === "SUSPENSA") {
      throw new ErroDominio("ACCOUNT_SUSPENDED", 403, "Conta suspensa.");
    }

    const superAdmin = usuario?.super_admin != null;
    // Antes do onboarding, a identidade validada no Auth já é suficiente.
    // A exigência de vínculo pertence à autorização específica de cada caso de uso.
    const vinculo = usuario && !superAdmin
      ? await buscarVinculoAtivoDoUsuario(idUsuario.data)
      : null;
    req.auth = {
      id_usuario: idUsuario.data,
      ...(email.success ? { email: email.data } : {}),
      super_admin: superAdmin,
      ...(vinculo ? { vinculo_ativo: vinculo } : {}),
    };
    next();
  } catch (erro: unknown) {
    next(erro instanceof errors.JOSEError
      ? new ErroDominio("UNAUTHENTICATED", 401, "Token inválido ou expirado.")
      : erro);
  }
};
