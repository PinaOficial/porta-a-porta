import { z } from "zod";
export const onboardingSchema = z.object({
  nome_completo: z.string().trim().min(3, "Informe um nome com pelo menos 3 caracteres.").max(160, "Use até 160 caracteres."),
  cpf: z.string().transform(cpf => cpf.replace(/\D/g, "")).pipe(z.string().regex(/^\d{11}$/, "Informe os 11 dígitos do CPF.")),
  data_nascimento: z.iso.date("Informe uma data de nascimento válida.")
    .refine(data => data <= new Date().toISOString().slice(0, 10), "A data de nascimento não pode estar no futuro."),
  id_condominio: z.uuid("Selecione seu condomínio."),
  moradia: z.string().trim().min(1, "Informe sua moradia.").max(80, "Use até 80 caracteres."),
});
