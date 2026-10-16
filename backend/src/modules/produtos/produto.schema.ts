import { z } from "zod";

export const tamanhoMaximoImagem = 5 * 1024 * 1024;
export const mimeImagemSchema = z.enum(["image/jpeg", "image/png", "image/webp"]);
export const arquivoImagemSchema = z.object({
  buffer: z.instanceof(Buffer),
  mimetype: mimeImagemSchema,
  size: z.number().int().positive().max(tamanhoMaximoImagem),
}).refine(({ buffer, size, mimetype }) => {
  if (buffer.length !== size) return false;
  // Inspeção básica de assinatura; não substitui decodificação/moderação da imagem.
  if (mimetype === "image/jpeg") return buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]));
  if (mimetype === "image/png") return buffer.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"));
  return buffer.length >= 12 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP";
}, "Conteúdo incompatível com o tipo da imagem.");

const inteiroPositivoQuery = (maximo: number) =>
  z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().min(1).max(maximo));

const uuidQuery = z.uuid().transform((valor) => valor.toLowerCase());

const camposConsultaProdutos = {
  id_categoria: uuidQuery.optional(),
  busca: z.string().trim().max(140).transform((valor) => valor || undefined).optional(),
  pagina: inteiroPositivoQuery(2_147_483_647).default(1),
  limite: inteiroPositivoQuery(100).default(20),
};

const paginacaoValida = ({ pagina, limite }: { pagina: number; limite: number }) =>
  (pagina - 1) * limite <= 2_147_483_647;
const erroPaginacao = {
  path: ["pagina"],
  message: "Página excede o intervalo permitido para paginação.",
};

export const listarMeusProdutosQuerySchema = z.strictObject({
  ...camposConsultaProdutos,
  ativo: z.enum(["true", "false"]).transform((valor) => valor === "true").optional(),
}).refine(paginacaoValida, erroPaginacao);

export type ListarMeusProdutosQuery = z.infer<typeof listarMeusProdutosQuerySchema>;

export const listarProdutosQuerySchema = z.strictObject({
  ...camposConsultaProdutos,
  // Compatibilidade com o filtro já publicado; o repository recebe somente id_categoria.
  categoria: uuidQuery.optional(),
  id_condominio: uuidQuery.optional(),
}).refine(paginacaoValida, erroPaginacao).refine(({ id_categoria, categoria }) => !id_categoria || !categoria || id_categoria === categoria, {
  path: ["id_categoria"],
  message: "Os filtros id_categoria e categoria devem indicar a mesma categoria.",
}).transform(({ categoria, ...filtros }) => ({
  ...filtros,
  ...(filtros.id_categoria || categoria ? { id_categoria: filtros.id_categoria ?? categoria } : {}),
}));

export type ListarProdutosQuery = z.infer<typeof listarProdutosQuerySchema>;

export const criarProdutoBodySchema = z.strictObject({
  id_categoria: z.uuid().transform((valor) => valor.toLowerCase()),
  nome_produto: z.string().trim().min(1).max(140),
  descricao: z.string().trim().min(1),
  preco: z.string().regex(/^\d{1,10}(?:\.\d{1,2})?$/, "Informe um preço decimal com até duas casas.")
    .refine((valor) => /[1-9]/.test(valor), "O preço deve ser maior que zero."),
  estoque: z.number().int().min(0).max(2_147_483_647),
});

export type CriarProdutoBody = z.infer<typeof criarProdutoBodySchema>;

export const produtoParamsSchema = z.strictObject({ id: uuidQuery });
export type ProdutoParams = z.infer<typeof produtoParamsSchema>;

export const detalheProdutoQuerySchema = z.strictObject({ id_condominio: uuidQuery.optional() });
export type DetalheProdutoQuery = z.infer<typeof detalheProdutoQuerySchema>;

export const excluirImagemProdutoParamsSchema = produtoParamsSchema.extend({ idImagem: uuidQuery });
export type ExcluirImagemProdutoParams = z.infer<typeof excluirImagemProdutoParamsSchema>;
export const excluirImagemProdutoQuerySchema = z.strictObject({});

export const editarProdutoBodySchema = criarProdutoBodySchema.partial().refine(
  (dados) => Object.values(dados).some((valor) => valor !== undefined),
  "Informe ao menos um campo editável.",
);
export type EditarProdutoBody = z.infer<typeof editarProdutoBodySchema>;

export const alterarStatusProdutoBodySchema = z.strictObject({ ativo: z.boolean() });
export type AlterarStatusProdutoBody = z.infer<typeof alterarStatusProdutoBodySchema>;
