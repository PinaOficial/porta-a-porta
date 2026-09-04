import { z } from "zod";

import { uuidSchema } from "@/lib/validations/common";

const personFields = z.object({
  nome: z.string().trim().min(2).max(150),
  dataNascimento: z.coerce.date().refine((value) => value <= new Date(), {
    message: "A data de nascimento nao pode estar no futuro.",
  }),
});

export const createMembroSchema = z.object({
  condominoId: uuidSchema.optional(),
  novoCondomino: personFields.optional(),
  apartamentoId: uuidSchema,
  tipoVinculo: z.enum(["proprietario", "inquilino"]),
}).strict().superRefine((value, context) => {
  if (Boolean(value.condominoId) === Boolean(value.novoCondomino)) {
    context.addIssue({ code: "custom", message: "Informe condominoId ou novoCondomino, mas nao ambos." });
  }
});

export const updateMembroSchema = z.object({
  apartamentoId: uuidSchema.optional(),
  tipoVinculo: z.enum(["proprietario", "inquilino"]).optional(),
}).strict().refine((value) => Object.keys(value).length > 0, {
  message: "Informe ao menos um campo para alteracao.",
});
