import { z } from "zod";

const condominioBaseSchema = z.object({
  nome: z
    .string()
    .trim()
    .min(2, "O nome precisa possuir pelo menos 2 caracteres.")
    .max(150, "O nome pode possuir no máximo 150 caracteres."),

  descricao: z.string().trim().max(2000).nullable().optional(),

  cep: z
    .string()
    .trim()
    .regex(/^\d{5}-?\d{3}$/, "CEP inválido.")
    .nullable()
    .optional(),

  logradouro: z.string().trim().max(150).nullable().optional(),

  numero: z.string().trim().max(20).nullable().optional(),

  complemento: z.string().trim().max(100).nullable().optional(),

  bairro: z.string().trim().max(100).nullable().optional(),

  cidade: z.string().trim().max(100).nullable().optional(),

  uf: z
    .string()
    .trim()
    .length(2, "UF deve possuir 2 caracteres.")
    .transform((value) => value.toUpperCase())
    .nullable()
    .optional(),
});

export const createCondominioSchema = condominioBaseSchema.strict();

export const updateCondominioSchema = condominioBaseSchema
  .partial()
  .strict()
  .refine(
    (data) => Object.keys(data).length > 0,
    "Informe pelo menos um campo para atualização.",
  );

export const condominioIdSchema = z.string().uuid();
