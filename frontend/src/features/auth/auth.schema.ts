import { z } from "zod";
export const loginSchema = z.object({
  email: z.string().trim().pipe(z.email("Informe um e-mail válido.")),
  senha: z.string().min(1, "Informe sua senha."),
});
export const cadastroSchema = loginSchema.extend({
  senha: z.string().min(6, "Use pelo menos 6 caracteres."),
  confirmacao: z.string(),
}).refine(dados => dados.senha === dados.confirmacao, {
  path: ["confirmacao"], message: "As senhas precisam ser iguais.",
});
