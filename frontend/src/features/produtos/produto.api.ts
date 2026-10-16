import { apiFetch, type ListaPaginada, type Objeto } from "../../lib/api";
import type { Categoria, DadosProduto, ImagemEnviada, MeuProduto, ProdutoAtualizado, ProdutoCriado, ProdutoDetalhe, ProdutoVitrine } from "./produto.types";
import { produtoDadosSchema, produtoPatchSchema, queryMeusProdutos, queryVitrine, type FiltrosMeusProdutos, type FiltrosVitrine } from "./produto.schema";
export const listarCategorias = (signal?: AbortSignal) => apiFetch<Objeto<Categoria[]>>("/categorias", { signal });
export const listarProdutos = (filtros: FiltrosVitrine, signal?: AbortSignal) =>
  apiFetch<ListaPaginada<ProdutoVitrine>>(`/produtos?${queryVitrine(filtros)}`, { signal });
export const obterProduto = (id: string, signal?: AbortSignal) =>
  apiFetch<Objeto<ProdutoDetalhe>>(`/produtos/${encodeURIComponent(id)}`, { signal });
export const listarMeusProdutos = (filtros: FiltrosMeusProdutos, signal?: AbortSignal) =>
  apiFetch<ListaPaginada<MeuProduto>>(`/produtos/me?${queryMeusProdutos(filtros)}`, { signal });
export const criarProduto = (dados: DadosProduto) =>
  apiFetch<Objeto<ProdutoCriado>>("/produtos", { method: "POST", json: produtoDadosSchema.parse(dados) });
export const editarProduto = (id: string, dados: Partial<DadosProduto>) =>
  apiFetch<Objeto<ProdutoAtualizado>>(`/produtos/${encodeURIComponent(id)}`, { method: "PATCH", json: produtoPatchSchema.parse(dados) });
export const alterarStatusProduto = (id: string, ativo: boolean) =>
  apiFetch<Objeto<ProdutoAtualizado>>(`/produtos/${encodeURIComponent(id)}/status`, { method: "PATCH", json: { ativo } });
export function enviarImagemProduto(id: string, arquivo: File) {
  const form = new FormData();
  form.append("imagem", arquivo);
  return apiFetch<Objeto<ImagemEnviada>>(`/produtos/${encodeURIComponent(id)}/imagens`, { method: "POST", body: form });
}
export const excluirImagemProduto = (id: string, idImagem: string) =>
  apiFetch<void>(`/produtos/${encodeURIComponent(id)}/imagens/${encodeURIComponent(idImagem)}`, { method: "DELETE" });
