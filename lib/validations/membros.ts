import { z } from "zod";

import { uuidSchema } from "@/lib/validations/common";

const personFields = z.object({
  nome: z.string().trim().min(2).max(150),
  email: z.email().trim().max(320),
  dataNascimento: z.coerce.date().refine((value) => value <= new Date(), {
    message: "A data de nascimento nao pode estar no futuro.",
  }),
});

export const createMembroSchema = z.object({
  nome: personFields.shape.nome,
  email: personFields.shape.email,
  dataNascimento: personFields.shape.dataNascimento,
  apartamentoId: uuidSchema,
  tipoVinculo: z.enum(["proprietario", "inquilino"]),
}).strict();

export const updateMembroSchema = z.object({
  apartamentoId: uuidSchema.optional(),
  tipoVinculo: z.enum(["proprietario", "inquilino"]).optional(),
}).strict().refine((value) => Object.keys(value).length > 0, {
  message: "Informe ao menos um campo para alteracao.",
});
