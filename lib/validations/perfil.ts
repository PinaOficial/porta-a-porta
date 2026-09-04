import { z } from "zod";

export const updatePerfilSchema = z.object({
  nome: z.string().trim().min(2).max(150).optional(),
  dataNascimento: z.coerce.date().refine((value) => value <= new Date(), {
    message: "A data de nascimento nao pode estar no futuro.",
  }).optional(),
}).strict().refine((value) => Object.keys(value).length > 0, {
  message: "Informe ao menos um campo para alteracao.",
});
