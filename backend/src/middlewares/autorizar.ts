import type { RequestHandler } from "express";
import { ErroDominio } from "../lib/erro-dominio.js";
import { obterVinculoAtivo } from "../lib/autorizacao-vitrine.js";

export function exigirVinculoAtivo(): RequestHandler {
  return (req, _res, next) => {
    obterVinculoAtivo(req.auth);
    next();
  };
}

export function exigirAdmin(): RequestHandler {
  return (req, _res, next) => {
    if (!req.auth) {
      next(new ErroDominio("UNAUTHENTICATED", 401, "Autenticação necessária."));
      return;
    }
    // vinculo_ativo é resolvido no banco pela autenticação, filtrando status ATIVO.
    if (!req.auth.super_admin && !req.auth.vinculo_ativo?.admin_condominio) {
      next(new ErroDominio("FORBIDDEN", 403, "Acesso administrativo necessário."));
      return;
    }
    next();
  };
}

export function exigirSuperAdmin(): RequestHandler {
  return (req, res, next) => {
    if (!req.auth?.super_admin) {
      return res.status(403).json({ erro: "FORBIDDEN" });
    }
    next();
  };
}
