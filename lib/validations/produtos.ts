import { z } from "zod";

import { priceSchema, stockSchema, uuidSchema } from "@/lib/validations/common";

const productFields = z.object({
  nome: z.string().trim().min(1).max(150),
  descricao: z.string().trim().max(2000).nullable().optional(),
  categoriaId: uuidSchema,
  preco: priceSchema,
  estoque: stockSchema,
});

export const createProdutoSchema = productFields.extend({ vinculoId: uuidSchema.optional() }).strict();
export const updateProdutoSchema = productFields.partial().strict().refine(
  (value) => Object.keys(value).length > 0,
  { message: "Informe ao menos um campo para alteracao." },
);
export const productQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().min(1).max(150).optional(),
  categoriaId: uuidSchema.optional(),
  mine: z.enum(["true", "false"]).transform((value) => value === "true").optional(),
  includeInactive: z.enum(["true", "false"]).transform((value) => value === "true").optional(),
});
