import { z } from "zod";

export const onboardingBodySchema = z.strictObject({
  nome_completo: z.string().trim().min(1).max(160),
  cpf: z.string().transform((cpf) => cpf.replace(/\D/g, "")).pipe(z.string().regex(/^\d{11}$/)),
  data_nascimento: z.iso.date().transform((data) => new Date(`${data}T00:00:00.000Z`)),
  id_condominio: z.uuid(),
  moradia: z.string().trim().min(1).max(80),
});

export type OnboardingBody = z.infer<typeof onboardingBodySchema>;

export const atualizarStatusContaBodySchema = z.strictObject({ status_conta: z.enum(["ATIVA", "SUSPENSA"]) });
export type AtualizarStatusContaBody = z.infer<typeof atualizarStatusContaBodySchema>;

export const consultarMeuUsuarioQuerySchema = z.strictObject({});
