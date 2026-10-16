import { randomUUID } from "node:crypto";
import { ErroDominio } from "../../lib/erro-dominio.js";
import { assinarImagensProdutos, enviarImagemProduto, PRODUCT_IMAGE_SIGNED_URL_TTL_SECONDS, removerImagemCompensatoria, removerImagemProduto } from "../../lib/storage.js";
import { arquivoImagemSchema, tamanhoMaximoImagem } from "./produto.schema.js";
import { autorizarAcessoVitrine, obterVinculoAtivo } from "../../lib/autorizacao-vitrine.js";
import { Prisma } from "../../generated/prisma/client.js";
import type { ContextoAutenticado } from "../../types/auth.js";
import { buscarCondominioAtivoPorId } from "../condominios/condominio.repository.js";
import { buscarCategoriaPorId } from "../categorias/categoria.repository.js";
import type { ArquivoImagemProduto, MeusProdutos, ProdutoImagemDto, ResultadoCriacaoProduto, ResultadoEdicaoProduto, ResultadoUploadImagem, VitrineProdutos } from "./produto.model.js";
import { atualizarProdutoDoVinculo, atualizarStatusProdutoDoVinculo, buscarImagemDoProduto, buscarMaiorOrdemImagem, buscarProdutoDoVinculo, criarImagemProduto, criarProduto, excluirRegistroImagemProduto, listarProdutosDoCondominio, listarProdutosDoVinculo } from "./produto.repository.js";
import type { CriarProdutoBody, EditarProdutoBody, ListarMeusProdutosQuery, ListarProdutosQuery } from "./produto.schema.js";
import type { DetalheProdutoQuery } from "./produto.schema.js";
import type { ResultadoDetalheProduto } from "./produto.model.js";
import { buscarDetalheProduto } from "./produto.repository.js";
import { prisma } from "../../lib/prisma.js";
import { buscarVinculoBloqueadoParaPedido } from "../pedidos/pedido.repository.js";

async function gravarComVinculoAtivo<T>(auth: ContextoAutenticado, gravar: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  const vinculo = obterVinculoAtivo(auth);
  return prisma.$transaction(async (tx) => {
    const atual = await buscarVinculoBloqueadoParaPedido(tx, vinculo.id_vinculo);
    if (!atual || atual.status_vinculo !== "ATIVO" || atual.id_condomino !== auth.id_usuario) {
      throw new ErroDominio("MEMBERSHIP_REQUIRED", 403, "Um vínculo ativo é necessário para gerenciar produtos.");
    }
    // Mantém o vínculo estável até gravar; transferência espera e desativa o produto ao concluir.
    return gravar(tx);
  }, { isolationLevel: "ReadCommitted" });
}

async function validarCategoriaAtiva(idCategoria: string): Promise<void> {
  const categoria = await buscarCategoriaPorId(idCategoria);
  if (!categoria) throw new ErroDominio("CATEGORY_NOT_FOUND", 404, "Categoria não encontrada.");
  if (!categoria.ativo) throw new ErroDominio("CATEGORY_INACTIVE", 409, "Categoria inativa.");
}

function montarProdutoDoVendedor(produto: Awaited<ReturnType<typeof atualizarProdutoDoVinculo>>): ResultadoEdicaoProduto["dados"] {
  return {
    id_produto: produto.id_produto,
    nome_produto: produto.nome_produto,
    descricao: produto.descricao,
    preco: produto.preco.toFixed(2),
    estoque: produto.estoque,
    ativo: produto.ativo,
    created_at: produto.created_at.toISOString(),
    updated_at: produto.updated_at.toISOString(),
    categoria: produto.categoria_produto,
  };
}

async function obterProdutoProprio(auth: ContextoAutenticado | undefined, idProduto: string) {
  const vinculo = obterVinculoAtivo(auth);
  const produto = await buscarProdutoDoVinculo(idProduto, vinculo.id_vinculo);
  if (!produto) {
    throw new ErroDominio("PRODUCT_NOT_FOUND", 404, "Produto não encontrado.");
  }
  return { produto, idVinculoVendedor: vinculo.id_vinculo };
}

export async function excluirImagemProduto(
  auth: ContextoAutenticado | undefined, idProduto: string, idImagem: string,
): Promise<void> {
  await obterProdutoProprio(auth, idProduto);
  const imagem = await buscarImagemDoProduto(idProduto, idImagem);
  if (!imagem) throw new ErroDominio("IMAGE_NOT_FOUND", 404, "Imagem não encontrada.");

  await removerImagemProduto(imagem.storage_path);
  // Storage não participa de transações Prisma. Preservar o registro permite tentar novamente.
  try {
    await excluirRegistroImagemProduto(idProduto, idImagem);
  } catch {
    console.error({ evento: "IMAGE_DELETE_INCONSISTENCY", id_produto: idProduto, id_imagem: idImagem,
      storage_path: imagem.storage_path, causa: "IMAGE_RECORD_DELETE_FAILED" });
    throw new ErroDominio("IMAGE_DELETE_FAILED", 500, "Não foi possível concluir a exclusão da imagem.");
  }
}

export async function adicionarImagemProduto(
  auth: ContextoAutenticado | undefined, idProduto: string, arquivo: ArquivoImagemProduto | undefined,
): Promise<ResultadoUploadImagem> {
  await obterProdutoProprio(auth, idProduto);
  if (!arquivo || arquivo.size === 0 || arquivo.buffer.length === 0) {
    throw new ErroDominio("IMAGE_REQUIRED", 400, "Envie uma imagem no campo imagem.");
  }
  if (arquivo.size > tamanhoMaximoImagem || arquivo.buffer.length > tamanhoMaximoImagem) {
    throw new ErroDominio("IMAGE_TOO_LARGE", 413, "A imagem deve ter no máximo 5 MB.");
  }
  const validacao = arquivoImagemSchema.safeParse(arquivo);
  if (!validacao.success) throw new ErroDominio("IMAGE_TYPE_NOT_ALLOWED", 415, "Use uma imagem JPEG, PNG ou WEBP com conteúdo compatível.");
  const extensoes = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" } as const;
  const ordem = (await buscarMaiorOrdemImagem(idProduto) ?? -1) + 1;
  // Limite do SMALLINT existente no banco; não é uma política de quantidade de imagens.
  if (ordem > 32_767) throw new ErroDominio("IMAGE_ORDER_EXHAUSTED", 409, "A ordem das imagens excede o intervalo do banco.");
  const storagePath = `produtos/${idProduto}/${randomUUID()}.${extensoes[validacao.data.mimetype]}`;
  await enviarImagemProduto(storagePath, arquivo.buffer, validacao.data.mimetype);
  let imagem: Awaited<ReturnType<typeof criarImagemProduto>>;
  try {
    imagem = await criarImagemProduto(idProduto, storagePath, ordem);
  } catch {
    try {
      await removerImagemCompensatoria(storagePath);
    } catch {
      console.error({ evento: "IMAGE_CLEANUP_FAILED", id_produto: idProduto, storage_path: storagePath, causa: "IMAGE_PERSISTENCE_FAILED" });
    }
    throw new ErroDominio("IMAGE_PERSISTENCE_FAILED", 500, "Não foi possível registrar a imagem.");
  }
  return { dados: { ...imagem, created_at: imagem.created_at.toISOString() } };
}

function mapearErroDeAtualizacaoProduto(erro: unknown): never {
  if (erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === "P2025") {
    throw new ErroDominio("PRODUCT_NOT_FOUND", 404, "Produto não encontrado.");
  }
  throw erro;
}

export async function alterarStatusProduto(
  auth: ContextoAutenticado | undefined,
  idProduto: string,
  ativo: boolean,
): Promise<ResultadoEdicaoProduto> {
  const { produto, idVinculoVendedor } = await obterProdutoProprio(auth, idProduto);
  if (ativo) await validarCategoriaAtiva(produto.id_categoria);
  try {
    const atualizado = await gravarComVinculoAtivo(auth!, (tx) => atualizarStatusProdutoDoVinculo(idProduto, idVinculoVendedor, ativo, tx));
    return { dados: montarProdutoDoVendedor(atualizado) };
  } catch (erro: unknown) {
    mapearErroDeAtualizacaoProduto(erro);
  }
}

export async function editarProduto(
  auth: ContextoAutenticado | undefined,
  idProduto: string,
  dados: EditarProdutoBody,
): Promise<ResultadoEdicaoProduto> {
  const { idVinculoVendedor } = await obterProdutoProprio(auth, idProduto);
  if (dados.id_categoria !== undefined) await validarCategoriaAtiva(dados.id_categoria);

  const { preco, ...demaisCampos } = dados;
  try {
    const produto = await gravarComVinculoAtivo(auth!, (tx) => atualizarProdutoDoVinculo(idProduto, idVinculoVendedor, {
      ...demaisCampos,
      ...(preco !== undefined ? { preco: new Prisma.Decimal(preco) } : {}),
    }, tx));
    return { dados: montarProdutoDoVendedor(produto) };
  } catch (erro: unknown) {
    mapearErroDeAtualizacaoProduto(erro);
  }
}

function montarPaginacaoProdutos(filtros: Pick<ListarProdutosQuery, "pagina" | "limite">, total: number): VitrineProdutos["paginacao"] {
  return {
    pagina: filtros.pagina,
    limite: filtros.limite,
    total,
    total_paginas: Math.ceil(total / filtros.limite),
  };
}

export async function listarMeusProdutos(
  auth: ContextoAutenticado | undefined,
  filtros: ListarMeusProdutosQuery,
): Promise<MeusProdutos> {
  const vinculo = obterVinculoAtivo(auth);
  const { produtos, total } = await listarProdutosDoVinculo(vinculo.id_vinculo, {
    id_categoria: filtros.id_categoria, busca: filtros.busca, ativo: filtros.ativo, limite: filtros.limite,
    deslocamento: (filtros.pagina - 1) * filtros.limite,
  });
  const urls = await assinarImagensProdutos(produtos.flatMap((produto) => produto.produto_imagem.map((imagem) => imagem.storage_path)));
  return {
    dados: produtos.map((produto) => ({
      ...montarProdutoDoVendedor(produto),
      imagens: montarImagensProduto(produto.produto_imagem, urls),
    })),
    paginacao: montarPaginacaoProdutos(filtros, total),
  };
}

export async function cadastrarProduto(
  auth: ContextoAutenticado | undefined,
  dados: CriarProdutoBody,
): Promise<ResultadoCriacaoProduto> {
  const vinculo = obterVinculoAtivo(auth);
  await validarCategoriaAtiva(dados.id_categoria);

  const produto = await gravarComVinculoAtivo(auth!, (tx) => criarProduto(vinculo.id_vinculo, { ...dados, preco: new Prisma.Decimal(dados.preco) }, tx));
  return { dados: {
    id_produto: produto.id_produto,
    nome_produto: produto.nome_produto,
    descricao: produto.descricao,
    preco: produto.preco.toFixed(2),
    estoque: produto.estoque,
    ativo: produto.ativo,
    created_at: produto.created_at.toISOString(),
    categoria: produto.categoria_produto,
  } };
}

function montarImagensProduto(
  imagens: Awaited<ReturnType<typeof listarProdutosDoCondominio>>["produtos"][number]["produto_imagem"],
  urls: ReadonlyMap<string, string>,
): ProdutoImagemDto[] {
  return imagens.flatMap((imagem) => {
    const url = urls.get(imagem.storage_path);
    return url ? [{ id_imagem: imagem.id_imagem, ordem: imagem.ordem, url, expires_in: PRODUCT_IMAGE_SIGNED_URL_TTL_SECONDS }] : [];
  });
}

export async function detalharProduto(auth: ContextoAutenticado | undefined, idProduto: string, filtros: DetalheProdutoQuery): Promise<ResultadoDetalheProduto> {
  const acesso = autorizarAcessoVitrine(auth);
  const idCondominio = acesso.super_admin ? filtros.id_condominio : acesso.vinculo_ativo.id_condominio;
  if (!idCondominio) throw new ErroDominio("CONDOMINIUM_REQUIRED", 400, "Informe o condomínio da vitrine.");
  if (acesso.super_admin && !await buscarCondominioAtivoPorId(idCondominio)) throw new ErroDominio("CONDOMINIO_NOT_FOUND", 404, "Condomínio não encontrado.");
  if (!acesso.super_admin && filtros.id_condominio && filtros.id_condominio !== idCondominio) {
    throw new ErroDominio("FORBIDDEN_CROSS_TENANT", 403, "Acesso restrito ao próprio condomínio.");
  }
  const produto = await buscarDetalheProduto(idProduto, idCondominio, acesso.super_admin ? undefined : acesso.vinculo_ativo.id_vinculo);
  if (!produto) throw new ErroDominio("PRODUCT_NOT_FOUND", 404, "Produto não encontrado.");
  const urls = await assinarImagensProdutos(produto.produto_imagem.map((i) => i.storage_path));
  return { dados: {
    ...montarProdutoDoVendedor(produto), imagens: montarImagensProduto(produto.produto_imagem, urls),
    vendedor: {
      id_vinculo: produto.vinculo_condominio.id_vinculo, nome_completo: produto.vinculo_condominio.condomino.nome_completo,
      moradia: produto.vinculo_condominio.moradia,
    },
  } };
}

export async function listarVitrineProdutos(
  auth: ContextoAutenticado | undefined,
  filtros: ListarProdutosQuery,
): Promise<VitrineProdutos> {
  const acesso = autorizarAcessoVitrine(auth);

  let idCondominio: string;
  if (acesso.super_admin) {
    if (!filtros.id_condominio) {
      throw new ErroDominio("CONDOMINIUM_REQUIRED", 400, "Informe o condomínio da vitrine.");
    }
    if (!await buscarCondominioAtivoPorId(filtros.id_condominio)) {
      throw new ErroDominio("CONDOMINIO_NOT_FOUND", 404, "Condomínio não encontrado.");
    }
    idCondominio = filtros.id_condominio;
  } else {
    idCondominio = acesso.vinculo_ativo.id_condominio;
    if (filtros.id_condominio && filtros.id_condominio.toLowerCase() !== idCondominio.toLowerCase()) {
      throw new ErroDominio("FORBIDDEN_CROSS_TENANT", 403, "Acesso restrito ao próprio condomínio.");
    }
  }

  const { produtos, total } = await listarProdutosDoCondominio(idCondominio, {
    id_categoria: filtros.id_categoria, busca: filtros.busca, limite: filtros.limite,
    deslocamento: (filtros.pagina - 1) * filtros.limite,
  });

  const urls = await assinarImagensProdutos(produtos.flatMap((produto) => produto.produto_imagem.map((imagem) => imagem.storage_path)));

  return {
    dados: produtos.map((produto) => ({
      id_produto: produto.id_produto,
      nome_produto: produto.nome_produto,
      descricao: produto.descricao,
      // Decimal em string preserva os centavos no contrato JSON.
      preco: produto.preco.toFixed(2),
      estoque: produto.estoque,
      created_at: produto.created_at.toISOString(),
      categoria: { id_categoria: produto.categoria_produto.id_categoria, nome: produto.categoria_produto.nome },
      vendedor: {
        id_vinculo: produto.vinculo_condominio.id_vinculo,
        nome_completo: produto.vinculo_condominio.condomino.nome_completo,
        moradia: produto.vinculo_condominio.moradia,
      },
      imagens: montarImagensProduto(produto.produto_imagem, urls),
    })),
    paginacao: montarPaginacaoProdutos(filtros, total),
  };
}
