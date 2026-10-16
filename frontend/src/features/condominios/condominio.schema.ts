import { z } from "zod";

export const criarCondominioSchema = z.strictObject({
  nome_residencial: z.string().trim().min(1, "Informe o nome do condomínio.").max(160, "Use até 160 caracteres."),
  cep: z.string().regex(/^(?:[0-9]{8}|[0-9]{5}-[0-9]{3})$/, "Informe oito dígitos (00000-000).")
    .transform(cep => cep.replace("-", "")),
  endereco: z.string().trim().min(1, "Informe o endereço completo.").max(255, "Use até 255 caracteres."),
});
export type CriarCondominio = z.output<typeof criarCondominioSchema>;
