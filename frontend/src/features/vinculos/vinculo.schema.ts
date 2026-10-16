import { z } from "zod";
export const transferenciaSchema = z.strictObject({
  id_condominio: z.uuid("Selecione o condomínio de destino."),
  moradia: z.string().trim().min(1, "Informe sua nova moradia.").max(80, "Use até 80 caracteres."),
});
export type SolicitarTransferencia = z.infer<typeof transferenciaSchema>;
