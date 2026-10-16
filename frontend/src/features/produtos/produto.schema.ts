import { z } from "zod";
import type { DadosProduto } from "./produto.types";
export const produtoIdSchema = z.uuid();
export const filtrosVitrineSchema = z.object({
  busca: z.string().trim().max(140, "Use até 140 caracteres na busca.").default(""),
  id_categoria: z.uuid("A categoria na URL é inválida.").transform(id => id.toLowerCase()).optional(),
  pagina: z.string().regex(/^\d+$/, "Página inválida.").default("1").transform(Number)
    .pipe(z.number().int().min(1).max(Math.floor(2_147_483_647 / 20) + 1)),
});
export type FiltrosVitrine = z.infer<typeof filtrosVitrineSchema>;
export function lerFiltrosVitrine(query: URLSearchParams) {
  return filtrosVitrineSchema.safeParse(Object.fromEntries(["busca", "id_categoria", "pagina"].flatMap(campo => {
    const valores = query.getAll(campo);
    return valores.length ? [[campo, valores.length > 1 ? valores : valores[0]]] : [];
  })));
}
export function queryVitrine(filtros: FiltrosVitrine) {
  const query = new URLSearchParams({ pagina: String(filtros.pagina), limite: "20" });
  if (filtros.busca.trim()) query.set("busca", filtros.busca.trim());
  if (filtros.id_categoria) query.set("id_categoria", filtros.id_categoria);
  return query;
}
export const filtrosMeusProdutosSchema = filtrosVitrineSchema.extend({ ativo: z.enum(["true", "false"]).optional() });
export type FiltrosMeusProdutos = z.infer<typeof filtrosMeusProdutosSchema>;
export function lerFiltrosMeusProdutos(query: URLSearchParams) {
  return filtrosMeusProdutosSchema.safeParse(Object.fromEntries(["busca", "id_categoria", "pagina", "ativo"].flatMap(campo => {
    const valores = query.getAll(campo);
    return valores.length ? [[campo, valores.length > 1 ? valores : valores[0]]] : [];
  })));
}
export function queryMeusProdutos(filtros: FiltrosMeusProdutos) {
  const query = queryVitrine(filtros);
  if (filtros.ativo !== undefined) query.set("ativo", filtros.ativo);
  return query;
}
const precoSchema = z.string().regex(/^\d{1,10}(?:\.\d{1,2})?$/, "Informe um preço com até 10 dígitos inteiros e 2 casas decimais.")
  .refine(valor => /[1-9]/.test(valor), "O preço deve ser maior que zero.");
export const produtoDadosSchema = z.strictObject({
  id_categoria: z.uuid("Selecione uma categoria."),
  nome_produto: z.string().trim().min(1, "Informe o nome do produto.").max(140, "Use até 140 caracteres."),
  descricao: z.string().trim().min(1, "Descreva o produto."),
  preco: precoSchema,
  estoque: z.number().int().min(0).max(2_147_483_647),
});
export const produtoPatchSchema = produtoDadosSchema.partial().refine(dados => Object.keys(dados).length > 0, "Nenhuma alteração para salvar.");
export function normalizarPreco(valor: string) {
  const normalizado = valor.trim().replace(",", ".");
  if (!precoSchema.safeParse(normalizado).success) return normalizado;
  const [inteiro, fracao = ""] = normalizado.split(".");
  return `${BigInt(inteiro)}.${fracao.padEnd(2, "0")}`;
}
export const formularioProdutoSchema = produtoDadosSchema.extend({
  preco: z.string().transform(normalizarPreco).pipe(precoSchema),
  estoque: z.string().trim().regex(/^\d+$/, "Informe um estoque inteiro, a partir de zero.").transform(Number)
    .pipe(z.number().int().min(0).max(2_147_483_647, "O estoque máximo é 2.147.483.647.")),
});
export function diferencaProduto(inicial: DadosProduto, atual: DadosProduto): Partial<DadosProduto> {
  const diff: Partial<DadosProduto> = {};
  for (const campo of ["id_categoria", "nome_produto", "descricao", "preco", "estoque"] as const) {
    const antes = campo === "preco" ? normalizarPreco(inicial.preco) : inicial[campo];
    if (antes !== atual[campo]) Object.assign(diff, { [campo]: atual[campo] });
  }
  return diff;
}
export const tamanhoMaximoImagemProduto = 5 * 1024 * 1024;
export const arquivoImagemProdutoSchema = z.object({
  type: z.enum(["image/jpeg", "image/png", "image/webp"], { error: "Escolha uma imagem JPEG, PNG ou WEBP." }),
  size: z.number().min(1, "O arquivo está vazio.").max(tamanhoMaximoImagemProduto, "A imagem deve ter até 5 MiB."),
});
