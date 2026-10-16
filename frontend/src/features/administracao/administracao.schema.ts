import { z } from "zod";
import { paginaHistoricoSchema } from "../pedidos/pedido.schema";
export const statusVinculoSchema = z.enum(["ATIVO", "PENDENTE", "REJEITADO", "SUSPENSO", "ENCERRADO"]);
export const filtrosAdministracaoSchema = z.strictObject({
  busca: z.string().trim().min(1).max(160, "Use até 160 caracteres na busca.").optional(),
  status: statusVinculoSchema.optional(),
  id_condominio: z.uuid("Condomínio inválido.").optional(),
  pagina: paginaHistoricoSchema(20),
});
export type FiltrosAdministracao = z.infer<typeof filtrosAdministracaoSchema>;
export function lerFiltrosAdministracao(query: URLSearchParams, pendentes = false) {
  const campos = Object.fromEntries([...query.keys()].map(campo => {
    const valores = query.getAll(campo);
    return [campo, valores.length > 1 ? valores : valores[0]];
  }));
  return (pendentes ? filtrosAdministracaoSchema.refine(dados => !dados.status, "A fila aceita apenas solicitações pendentes; remova o filtro de status.") : filtrosAdministracaoSchema).safeParse(campos);
}
export const alterarAdminSchema = z.strictObject({ admin_condominio: z.boolean() });
export const alterarContaSchema = z.strictObject({ status_conta: z.enum(["ATIVA", "SUSPENSA"]) });
