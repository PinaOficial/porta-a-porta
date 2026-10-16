import { z } from "zod";
export function converterHorarioLocal(valor: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(valor)) return null;
  const data = new Date(valor);
  if (!Number.isFinite(data.getTime())) return null;
  const [ano, mes, dia, hora, minuto] = valor.split(/[-T:]/).map(Number);
  // Rejeita rollover de datas e horários inexistentes na mudança de fuso local.
  if (data.getFullYear() !== ano || data.getMonth() + 1 !== mes || data.getDate() !== dia || data.getHours() !== hora || data.getMinutes() !== minuto) return null;
  return data.toISOString();
}
export function horarioLocalAtual() {
  const data = new Date();
  const pad = (numero: number) => String(numero).padStart(2, "0");
  return `${data.getFullYear()}-${pad(data.getMonth() + 1)}-${pad(data.getDate())}T${pad(data.getHours())}:${pad(data.getMinutes())}`;
}
export const formularioPedidoSchema = (estoque: number) => z.object({
  quantidade: z.string().regex(/^\d+$/, "Informe uma quantidade inteira.").transform(Number)
    .pipe(z.number().int().min(1, "A quantidade mínima é 1.").max(Math.min(estoque, 2_147_483_647), `Há ${estoque} unidade(s) disponíveis.`)),
  hora_combinada: z.string().refine(valor => converterHorarioLocal(valor) !== null, "Escolha uma data e hora válidas.")
    .transform(valor => converterHorarioLocal(valor)!)
    .refine(valor => Date.parse(valor) >= Date.now(), "Escolha uma data e hora futuras."),
});
export const statusPedidoSchema = z.enum(["SOLICITADO", "ACEITO", "RECUSADO", "CANCELADO", "CONCLUIDO"]);
export const paginaHistoricoSchema = (limite: number) => z.string().regex(/^\d+$/, "Página inválida.").default("1").transform(Number)
  .pipe(z.number().int().min(1).max(Math.floor(2_147_483_647 / limite) + 1));
export const filtrosPedidosSchema = z.object({
  papel: z.enum(["compra", "venda"]).optional(),
  status: statusPedidoSchema.optional(),
  pagina: paginaHistoricoSchema(20),
});
export type FiltrosPedidos = z.infer<typeof filtrosPedidosSchema>;
export function lerFiltrosPedidos(query: URLSearchParams) {
  return filtrosPedidosSchema.safeParse(Object.fromEntries(["papel", "status", "pagina"].flatMap(campo => {
    const valores = query.getAll(campo);
    return valores.length ? [[campo, valores.length > 1 ? valores : valores[0]]] : [];
  })));
}
export const alterarStatusPedidoSchema = z.strictObject({
  status: z.enum(["ACEITO", "RECUSADO", "CANCELADO", "CONCLUIDO"]),
  motivo: z.string().trim().max(255, "Use até 255 caracteres no motivo.").optional(),
}).transform(({ status, motivo }) => ({ status, ...(motivo ? { motivo } : {}) }));
