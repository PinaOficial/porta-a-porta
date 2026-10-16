export interface Categoria { id_categoria: string; nome: string }
export interface ImagemProduto { id_imagem: string; ordem: number; url: string; expires_in: number }
export interface ProdutoVitrine {
  id_produto: string;
  nome_produto: string;
  descricao: string;
  preco: string;
  estoque: number;
  created_at: string;
  categoria: Categoria;
  vendedor: { id_vinculo: string; nome_completo: string; moradia: string };
  imagens: ImagemProduto[];
}
export interface ProdutoDetalhe extends ProdutoVitrine {
  ativo: boolean;
  updated_at: string;
  categoria: Categoria & { ativo: boolean };
}
export type MeuProduto = Omit<ProdutoDetalhe, "vendedor">;
export type ProdutoAtualizado = Omit<MeuProduto, "imagens">;
export type ProdutoCriado = Pick<ProdutoVitrine, "id_produto" | "nome_produto" | "descricao" | "preco" | "estoque" | "created_at" | "categoria"> & { ativo: boolean };
export interface DadosProduto {
  id_categoria: string;
  nome_produto: string;
  descricao: string;
  preco: string;
  estoque: number;
}
export interface ImagemEnviada { id_imagem: string; id_produto: string; ordem: number; created_at: string }
