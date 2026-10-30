import { z } from "zod";

const inteiroPositivoQuery = (maximo: number) =>
  z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().min(1).max(maximo));

export const listarCondominiosQuerySchema = z.strictObject({
  busca: z.string().trim().min(1).max(160).optional(),
  pagina: inteiroPositivoQuery(2_147_483_647).default(1),
  limite: inteiroPositivoQuery(50).default(20),
}).refine(({ pagina, limite }) => (pagina - 1) * limite <= 2_147_483_647, {
  path: ["pagina"],
  message: "Página excede o intervalo permitido para paginação.",
});

export type ListarCondominiosQuery = z.infer<typeof listarCondominiosQuerySchema>;

export const criarCondominioBodySchema = z.strictObject({
  nome_residencial: z.string().trim().min(1).max(160),
  cep: z.string().regex(/^[0-9]{8}$/, "Informe o CEP com oito dígitos."),
  endereco: z.string().trim().min(1).max(255),
});
export type CriarCondominioBody = z.infer<typeof criarCondominioBodySchema>;

export const listarCondominiosAdminQuerySchema = listarCondominiosQuerySchema.safeExtend({
  ativo: z.enum(["true", "false"]).transform(valor => valor === "true").optional(),
});
export const condominioAdminParamsSchema = z.strictObject({ id: z.uuid().transform(id => id.toLowerCase()) });
export const semQueryCondominioSchema = z.strictObject({});
const versaoSchema = z.string().regex(/^[a-f0-9]{64}$/, "Recarregue os dados do condomínio.");
export const editarCondominioBodySchema = criarCondominioBodySchema.partial().extend({ versao: versaoSchema })
  .refine(dados => [dados.nome_residencial, dados.cep, dados.endereco].some(valor => valor !== undefined), {
    message: "Informe pelo menos um campo cadastral.",
  });
export const statusCondominioBodySchema = z.strictObject({
  ativo: z.boolean(), versao: versaoSchema, motivo: z.string().trim().min(1).max(255),
});
export type ListarCondominiosAdminQuery = z.infer<typeof listarCondominiosAdminQuerySchema>;
export type EditarCondominioBody = z.infer<typeof editarCondominioBodySchema>;
export type StatusCondominioBody = z.infer<typeof statusCondominioBodySchema>;
