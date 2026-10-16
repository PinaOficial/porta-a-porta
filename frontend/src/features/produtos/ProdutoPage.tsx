import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { Aviso } from "../../components/ui/Campo";
import { ApiError } from "../../lib/api";
import { formatarReais } from "../../lib/moeda";
import { useEstadoUsuario } from "../perfil/EstadoUsuarioProvider";
import { FormularioPedido } from "../pedidos/FormularioPedido";
import { ConfirmacaoPedido } from "../pedidos/ConfirmacaoPedido";
import type { PedidoCriado } from "../pedidos/pedido.types";
import { GaleriaProduto } from "./ImagemProduto";
import { obterProduto } from "./produto.api";
import { produtoIdSchema } from "./produto.schema";
import type { ProdutoDetalhe } from "./produto.types";

export function ProdutoPage() {
  const { id = "" } = useParams();
  return <DetalheProduto key={id} id={id} />;
}
function DetalheProduto({ id }: { id: string }) {
  const { state } = useLocation();
  const voltar = typeof state?.voltar === "string" && /^\/vitrine(?:\?|$)/.test(state.voltar) ? state.voltar : "/vitrine";
  const [produto, setProduto] = useState<ProdutoDetalhe | null>(null);
  const [erro, setErro] = useState<ApiError | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [pedido, setPedido] = useState<PedidoCriado | null>(null);
  const controle = useRef<AbortController | null>(null);
  const { situacaoResidencial, recarregarEstado } = useEstadoUsuario();
  const carregar = useCallback(async () => {
    controle.current?.abort();
    const abort = new AbortController(); controle.current = abort;
    setCarregando(true); setErro(null);
    if (!produtoIdSchema.safeParse(id).success) {
      setErro(new ApiError(404, "PRODUCT_NOT_FOUND", "Produto indisponível.")); setCarregando(false); return;
    }
    try {
      const resposta = await obterProduto(id, abort.signal);
      if (!abort.signal.aborted) setProduto(resposta.dados);
    } catch (erro) {
      if (!abort.signal.aborted) {
        const falha = erro instanceof ApiError ? erro : new ApiError(0, "NETWORK_ERROR", "Não foi possível carregar o produto.");
        setErro(falha);
        if (falha.codigo === "PRODUCT_NOT_FOUND") setProduto(null);
        if (["MEMBERSHIP_REQUIRED", "FORBIDDEN_CROSS_TENANT"].includes(falha.codigo)) void recarregarEstado();
      }
    } finally { if (!abort.signal.aborted) setCarregando(false); }
  }, [id, recarregarEstado]);
  useEffect(() => { void carregar(); return () => controle.current?.abort(); }, [carregar]);
  const proprio = produto?.vendedor.id_vinculo === situacaoResidencial?.vinculo_ativo?.id_vinculo;
  return <div className="pagina-produto"><Link className="voltar-vitrine" to={voltar}>← Voltar à vitrine</Link>
    {pedido ? <ConfirmacaoPedido pedido={pedido} voltar={voltar} /> : <>
      {carregando && <p role="status">{produto ? "Atualizando produto…" : "Carregando produto…"}</p>}
      {erro && <section className="card"><h1>{erro.codigo === "PRODUCT_NOT_FOUND" ? "Produto indisponível" : "Não foi possível abrir este produto"}</h1><Aviso erro>{erro.codigo === "PRODUCT_NOT_FOUND" ? "O anúncio não está disponível na sua vitrine." : erro.codigo === "FORBIDDEN_CROSS_TENANT" ? "O produto não pertence ao condomínio permitido pelo seu acesso." : "Verifique sua conexão e tente novamente."}</Aviso><button className="botao-secundario" onClick={() => void carregar()}>Tentar novamente</button></section>}
      {produto && <><article className="card detalhe-produto" aria-busy={carregando}><GaleriaProduto key={produto.id_produto} imagens={produto.imagens} nome={produto.nome_produto} /><div className="informacoes-produto"><span className="categoria-produto">{produto.categoria.nome}</span><h1>{produto.nome_produto}</h1><p className="preco preco-detalhe">{formatarReais(produto.preco)}</p><p className="estoque">{produto.estoque > 0 ? `${produto.estoque} em estoque` : "Sem estoque no momento"}</p><p className="descricao-produto">{produto.descricao}</p><dl className="detalhes"><dt>Vendido por</dt><dd>{produto.vendedor.nome_completo}</dd><dt>Moradia</dt><dd>{produto.vendedor.moradia}</dd></dl>{proprio && <Aviso><span>Este anúncio é seu</span> <Link to={`/meus-produtos/${produto.id_produto}/editar`}>Editar anúncio</Link></Aviso>}{!produto.ativo || !produto.categoria.ativo ? <Aviso>Este anúncio não está disponível para pedidos.</Aviso> : null}</div></article>
        {!proprio && <FormularioPedido produto={produto} bloqueado={carregando || Boolean(erro)} atualizarProduto={carregar} aoCriar={setPedido} />}
      </>}
    </>}
  </div>;
}
