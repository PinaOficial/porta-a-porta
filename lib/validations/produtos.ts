import { z } from "zod";

import {
  emptyStringToUndefined,
  priceSchema,
  stockSchema,
  uuidSchema,
} from "@/lib/validations/common";

const productFields = z.object({
  nome: z
    .string()
    .trim()
    .min(1, "O nome do produto é obrigatório.")
    .max(150, "O nome deve ter no máximo 150 caracteres."),

  descricao: z
    .string()
    .trim()
    .max(2000, "A descrição deve ter no máximo 2000 caracteres.")
    .nullable()
    .optional(),

  categoriaId: uuidSchema,

  preco: priceSchema,

  estoque: stockSchema,
});

export const createProdutoSchema = productFields
  .extend({
    vinculoId: uuidSchema.optional(),
  })
  .strict();

export const updateProdutoSchema = productFields
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "Informe ao menos um campo para alteracao.",
  });

export const productQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),

  limit: z.coerce.number().int().min(1).max(100).default(20),

  search: z.preprocess(
    emptyStringToUndefined,
    z.string().trim().min(1).max(150).optional(),
  ),

  categoriaId: z.preprocess(emptyStringToUndefined, uuidSchema.optional()),

  mine: z.preprocess(
    emptyStringToUndefined,
    z
      .enum(["true", "false"])
      .transform((value) => value === "true")
      .optional(),
  ),

  includeInactive: z.preprocess(
    emptyStringToUndefined,
    z
      .enum(["true", "false"])
      .transform((value) => value === "true")
      .optional(),
  ),
});
