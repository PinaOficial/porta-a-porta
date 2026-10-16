import type { RequestHandler } from "express";
import type { ZodType } from "zod";

export function validarParams<T>(schema: ZodType<T>): RequestHandler {
  return (req, res, next) => {
    const resultado = schema.safeParse(req.params);
    if (!resultado.success) {
      res.status(400).json({ erro: "VALIDATION_ERROR", detalhes: resultado.error.flatten() });
      return;
    }
    res.locals.paramsValidados = resultado.data;
    next();
  };
}

export const validarSemBody: RequestHandler = (req, res, next) => {
  if (req.body !== undefined) {
    res.status(400).json({ erro: "VALIDATION_ERROR", mensagem: "Esta rota não aceita body." });
    return;
  }
  next();
};

export function validarQuery<T>(schema: ZodType<T>): RequestHandler {
  return (req, res, next) => {
    const resultado = schema.safeParse(req.query);
    if (!resultado.success) {
      res.status(400).json({
        erro: "VALIDATION_ERROR",
        detalhes: resultado.error.flatten(),
      });
      return;
    }

    // Express 5 expõe req.query como getter; a entrada validada fica em locals.
    res.locals.queryValidada = resultado.data;
    next();
  };
}

export function validarBody(schema: ZodType): RequestHandler {
  return (req, res, next) => {
    const resultado = schema.safeParse(req.body);

    if (!resultado.success) {
      return res.status(400).json({
        erro: "VALIDATION_ERROR",
        detalhes: resultado.error.flatten(),
      });
    }

    req.body = resultado.data;
    next();
  };
}
