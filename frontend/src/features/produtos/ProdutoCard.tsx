import { Link } from "react-router-dom";
import type { ProdutoVitrine } from "./produto.types";
import { ImagemProduto } from "./ImagemProduto";
import { formatarReais } from "../../lib/moeda";
export function ProdutoCard({ produto, voltar }: { produto: ProdutoVitrine; voltar: string }) {
  return <article className="produto-card"><Link to={`/produtos/${produto.id_produto}`} state={{ voltar }} className="produto-link">
    <ImagemProduto url={produto.imagens[0]?.url} nome={produto.nome_produto} />
    <div className="produto-card-conteudo"><span className="categoria-produto">{produto.categoria.nome}</span><h2>{produto.nome_produto}</h2>
      <p className="preco">{formatarReais(produto.preco)}</p>
      <p className="estoque">{produto.estoque > 0 ? `${produto.estoque} em estoque` : "Sem estoque no momento"}</p>
      <p className="vendedor-card">{produto.vendedor.nome_completo}<span>{produto.vendedor.moradia}</span></p>
      <span className="ver-produto">Ver produto <span aria-hidden="true">→</span></span>
    </div>
  </Link></article>;
}
