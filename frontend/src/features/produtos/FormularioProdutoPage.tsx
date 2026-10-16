import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { ApiError } from "../../lib/api";
import { Aviso } from "../../components/ui/Campo";
import { useEstadoUsuario } from "../perfil/EstadoUsuarioProvider";
import { obterProduto } from "./produto.api";
import { produtoIdSchema } from "./produto.schema";
import { mensagemErroProduto } from "./produto.erros";
import type { ProdutoDetalhe } from "./produto.types";
import { useCategoriasProduto } from "./useCategoriasProduto";
import { FormularioProduto } from "./FormularioProduto";
import { GerenciadorImagensProduto } from "./GerenciadorImagensProduto";
import { AcaoStatusProduto } from "./AcaoStatusProduto";

export function FormularioProdutoPage({ novo = false }: { novo?: boolean }) {
  const { id = "" } = useParams();
  return <EditorProduto key={novo ? "novo" : id} id={novo ? null : id} />;
}
function EditorProduto({ id }: { id: string | null }) {
  const navigate = useNavigate();
  const { state } = useLocation();
  const voltar = typeof state?.voltar === "string" && /^\/meus-produtos(?:\?|$)/.test(state.voltar) ? state.voltar : "/meus-produtos";
  const { situacaoResidencial, recarregarEstado } = useEstadoUsuario();
  const idVinculo = situacaoResidencial?.vinculo_ativo?.id_vinculo;
  const categorias = useCategoriasProduto();
  const [produto, setProduto] = useState<ProdutoDetalhe | null>(null);
  const [carregando, setCarregando] = useState(Boolean(id));
  const [erroLeitura, setErroLeitura] = useState<ApiError | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [versaoFormulario, setVersaoFormulario] = useState(0);
  const [sucesso, setSucesso] = useState(state?.criado === true ? "Produto publicado. Agora você pode adicionar imagens." : "");
  const controle = useRef<AbortController | null>(null);
  const montado = useRef(false);
  const reiniciarPendente = useRef(false);
  const carregar = useCallback(async (reiniciarFormulario = false) => {
    if (!id || !montado.current) return;
    if (reiniciarFormulario) reiniciarPendente.current = true;
    controle.current?.abort();
    const abort = new AbortController(); controle.current = abort;
    setCarregando(true); setErroLeitura(null);
    try {
      if (!produtoIdSchema.safeParse(id).success) throw new ApiError(404, "PRODUCT_NOT_FOUND", "Produto indisponível.");
      const resposta = await obterProduto(id, abort.signal);
      if (abort.signal.aborted) return;
      // Leitura pública do mesmo condomínio não concede permissão de gestão.
      if (resposta.dados.vendedor.id_vinculo !== idVinculo) throw new ApiError(404, "PRODUCT_NOT_FOUND", "Produto indisponível.");
      setProduto(resposta.dados);
      if (reiniciarPendente.current) { setVersaoFormulario(atual => atual + 1); reiniciarPendente.current = false; }
    } catch (erro) {
      if (!abort.signal.aborted) {
        const falha = erro instanceof ApiError ? erro : new ApiError(0, "NETWORK_ERROR", "Não foi possível carregar o anúncio.");
        setErroLeitura(falha);
        if (["PRODUCT_NOT_FOUND", "MEMBERSHIP_REQUIRED", "FORBIDDEN_CROSS_TENANT"].includes(falha.codigo)) setProduto(null);
        if (["MEMBERSHIP_REQUIRED", "FORBIDDEN_CROSS_TENANT"].includes(falha.codigo)) void recarregarEstado();
      }
    } finally { if (!abort.signal.aborted) setCarregando(false); }
  }, [id, idVinculo, recarregarEstado]);
  useEffect(() => { montado.current = true; void carregar(); return () => { montado.current = false; controle.current?.abort(); }; }, [carregar]);
  async function tratarErro(erro: unknown) {
    if (!montado.current || !(erro instanceof ApiError)) return;
    if (["MEMBERSHIP_REQUIRED", "FORBIDDEN_CROSS_TENANT"].includes(erro.codigo)) { setProduto(null); await recarregarEstado(); }
    if (erro.codigo === "PRODUCT_NOT_FOUND") { setProduto(null); setErroLeitura(erro); }
    if (["CATEGORY_NOT_FOUND", "CATEGORY_INACTIVE"].includes(erro.codigo)) categorias.atualizar();
  }
  async function salvar(idSalvo: string) {
    if (!montado.current) return;
    if (!id) { navigate(`/meus-produtos/${idSalvo}/editar`, { replace: true, state: { criado: true, voltar } }); return; }
    setSucesso("Alterações salvas.");
    await carregar(true);
  }
  const atualizar = useCallback(() => carregar(), [carregar]);
  return <div className="pagina-editor"><Link className="voltar-vitrine" to={voltar}>← Voltar a Meus Produtos</Link><h1>{id ? "Editar produto" : "Novo produto"}</h1>
    {sucesso && <Aviso>{sucesso}</Aviso>}{carregando && <p role="status">{produto ? "Atualizando anúncio…" : "Carregando anúncio…"}</p>}
    {erroLeitura && <section className="card"><h2>{erroLeitura.codigo === "PRODUCT_NOT_FOUND" ? "Anúncio indisponível para edição" : "Não foi possível atualizar o anúncio"}</h2><Aviso erro>{erroLeitura.codigo === "PRODUCT_NOT_FOUND" ? mensagemErroProduto(erroLeitura) : "Verifique sua conexão e tente novamente. As alterações digitadas foram mantidas."}</Aviso><button className="botao-secundario" disabled={carregando || ocupado} onClick={() => void carregar()}>Tentar novamente</button></section>}
    {(!id || produto) && <><FormularioProduto key={versaoFormulario} produto={produto ?? undefined} categorias={categorias.categorias} carregandoCategorias={categorias.carregando} erroCategorias={categorias.erro} atualizarCategorias={categorias.atualizar} bloqueado={ocupado || carregando || Boolean(erroLeitura)} voltar={voltar} aoSalvar={salvar} aoErro={tratarErro} aoOcupar={setOcupado} />
      {produto && <><section className="card status-editor"><h2>Status do anúncio</h2><p className="etiqueta">{produto.ativo ? "Ativo" : "Inativo"}</p><AcaoStatusProduto id={produto.id_produto} ativo={produto.ativo} bloqueado={ocupado || carregando || Boolean(erroLeitura)} atualizar={atualizar} aoErro={tratarErro} aoOcupar={setOcupado} /></section>
      <GerenciadorImagensProduto id={produto.id_produto} nome={produto.nome_produto} imagens={produto.imagens} bloqueado={ocupado || carregando || Boolean(erroLeitura)} atualizar={atualizar} aoErro={tratarErro} aoOcupar={setOcupado} /></>}
    </>}
  </div>;
}
