import type { RequestHandler } from "express";
import multer from "multer";
import { ErroDominio } from "../../lib/erro-dominio.js";
import { mimeImagemSchema, tamanhoMaximoImagem } from "./produto.schema.js";

const receberImagem = multer({
  storage: multer.memoryStorage(),
  // Busboy dispara o limite ao atingir o valor; um byte sentinela permite exatamente 5 MB.
  // O service ainda rejeita qualquer buffer maior que tamanhoMaximoImagem.
  limits: { fileSize: tamanhoMaximoImagem + 1, files: 1, fields: 0, parts: 2 },
  fileFilter: (_req, arquivo, callback) => {
    if (!mimeImagemSchema.safeParse(arquivo.mimetype).success) {
      callback(new ErroDominio("IMAGE_TYPE_NOT_ALLOWED", 415, "Use uma imagem JPEG, PNG ou WEBP."));
      return;
    }
    callback(null, true);
  },
}).single("imagem");

export const uploadImagemProduto: RequestHandler = (req, res, next) => {
  if (!req.is("multipart/form-data")) {
    next(new ErroDominio("IMAGE_REQUIRED", 400, "Envie uma imagem no campo imagem de um formulário multipart."));
    return;
  }
  receberImagem(req, res, (erro: unknown) => {
    if (!erro || erro instanceof ErroDominio) return next(erro);
    if (erro instanceof multer.MulterError && erro.code === "LIMIT_FILE_SIZE") {
      return next(new ErroDominio("IMAGE_TOO_LARGE", 413, "A imagem deve ter no máximo 5 MB."));
    }
    next(new ErroDominio("VALIDATION_ERROR", 400, "Envie somente um arquivo no campo imagem, sem campos adicionais."));
  });
};
