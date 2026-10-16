import type { ErrorRequestHandler } from "express";
import { ErroDominio } from "../lib/erro-dominio.js";

export const errorHandler: ErrorRequestHandler = (erro, _req, res, _next) => {
  // O parser JSON inclui o body no erro; não registrar nem devolver esse conteúdo.
  if (erro instanceof Error && "type" in erro && erro.type === "entity.parse.failed") {
    res.status(400).json({ erro: "VALIDATION_ERROR", mensagem: "JSON inválido." });
    return;
  }
  if (erro instanceof Error && "type" in erro && erro.type === "entity.too.large") {
    res.status(413).json({ erro: "PAYLOAD_TOO_LARGE", mensagem: "O corpo da requisição excede o limite permitido." });
    return;
  }
  if (erro instanceof ErroDominio) {
    res.status(erro.statusHttp).json({ erro: erro.codigo, mensagem: erro.message });
    return;
  }

  // Erros Prisma podem incluir valores pessoais e parâmetros das queries.
  // Registrar apenas identificação técnica evita expor payloads, tokens ou credenciais.
  console.error({
    evento: "INTERNAL_ERROR",
    tipo: erro instanceof Error ? erro.name : "UnknownError",
  });

  res.status(500).json({
    erro: "INTERNAL_ERROR",
    mensagem: "Erro interno do servidor.",
  });
};
