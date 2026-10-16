import type { criarImagemProduto, criarProduto, listarProdutosDoCondominio, listarProdutosDoVinculo } from "./produto.repository.js";

export interface ArquivoImagemProduto {
  buffer: Buffer;
  mimetype: string;
  size: number;
}

type ImagemCriada = Awaited<ReturnType<typeof criarImagemProduto>>;
export interface ResultadoUploadImagem {
  dados: Omit<ImagemCriada, "created_at"> & { created_at: string };
}

type ProdutoDoVinculo = Awaited<ReturnType<typeof listarProdutosDoVinculo>>["produtos"][number];

export interface ResultadoEdicaoProduto {
  dados: Omit<MeusProdutos["dados"][number], "imagens">;
}

export interface ResultadoDetalheProduto {
  dados: MeusProdutos["dados"][number] & { vendedor: ProdutoVitrine["vendedor"] };
}

export interface ProdutoImagemDto {
  id_imagem: string;
  ordem: number;
  url: string;
  expires_in: number;
}

export interface MeusProdutos {
  dados: (Pick<ProdutoDoVinculo, "id_produto" | "nome_produto" | "descricao" | "estoque" | "ativo"> & {
    preco: string;
    created_at: string;
    updated_at: string;
    categoria: ProdutoDoVinculo["categoria_produto"];
    imagens: ProdutoImagemDto[];
  })[];
  paginacao: VitrineProdutos["paginacao"];
}

type ProdutoCriado = Awaited<ReturnType<typeof criarProduto>>;

export interface ResultadoCriacaoProduto {
  dados: Pick<ProdutoCriado, "id_produto" | "nome_produto" | "descricao" | "estoque" | "ativo"> & {
    preco: string;
    created_at: string;
    categoria: ProdutoCriado["categoria_produto"];
  };
}

type ProdutoConsultado = Awaited<ReturnType<typeof listarProdutosDoCondominio>>["produtos"][number];

export type ProdutoVitrine = Pick<ProdutoConsultado,
  "id_produto" | "nome_produto" | "descricao" | "estoque"
> & {
  preco: string;
  created_at: string;
  categoria: ProdutoConsultado["categoria_produto"];
  vendedor: Pick<ProdutoConsultado["vinculo_condominio"], "id_vinculo" | "moradia"> &
    ProdutoConsultado["vinculo_condominio"]["condomino"];
  imagens: ProdutoImagemDto[];
};

export interface VitrineProdutos {
  dados: ProdutoVitrine[];
  paginacao: {
    pagina: number;
    limite: number;
    total: number;
    total_paginas: number;
  };
}
