import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ApiError, type ListaPaginada } from "../../lib/api";
import { Aviso, Campo } from "../../components/ui/Campo";
import { formatarReais } from "../../lib/moeda";
import { useEstadoUsuario } from "../perfil/EstadoUsuarioProvider";
import { listarMeusProdutos } from "./produto.api";
import { lerFiltrosMeusProdutos } from "./produto.schema";
import type { MeuProduto } from "./produto.types";
import { ImagemProduto } from "./ImagemProduto";
import { useCategoriasProduto } from "./useCategoriasProduto";
import { AcaoStatusProduto } from "./AcaoStatusProduto";

export function MeusProdutosPage() {
  const [query, setQuery] = useSearchParams();
  const validacao = lerFiltrosMeusProdutos(query);
  const busca = validacao.success ? validacao.data.busca : "";
  const categoria = validacao.success ? validacao.data.id_categoria : undefined;
  const ativo = validacao.success ? validacao.data.ativo : undefined;
  const pagina = validacao.success ? validacao.data.pagina : 1;
  const valida = validacao.success;
  const [textoBusca, setTextoBusca] = useState(busca);
  const [resultado, setResultado] = useState<ListaPaginada<MeuProduto> | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState(false);
  const [aviso, setAviso] = useState("");
  const controle = useRef<AbortController | null>(null);
  const montado = useRef(false);
  const categorias = useCategoriasProduto();
  const { recarregarEstado } = useEstadoUsuario();
  const carregarAtual = useRef<() => Promise<void>>(async () => {});
  const atualizarLista = useCallback(() => carregarAtual.current(), []);
  useEffect(() => setTextoBusca(busca), [busca]);
  const carregar = useCallback(async () => {
    controle.current?.abort();
    if (!valida || !montado.current) return;
    const abort = new AbortController(); controle.current = abort;
    setCarregando(true); setErro(false);
    try {
      const resposta = await listarMeusProdutos({ busca, id_categoria: categoria, ativo, pagina }, abort.signal);
      if (!abort.signal.aborted) setResultado(resposta);
    } catch (erro) {
      if (!abort.signal.aborted) {
        setErro(true);
        if (erro instanceof ApiError && ["MEMBERSHIP_REQUIRED", "FORBIDDEN_CROSS_TENANT"].includes(erro.codigo)) void recarregarEstado();
      }
    } finally { if (!abort.signal.aborted) setCarregando(false); }
  }, [busca, categoria, ativo, pagina, valida, recarregarEstado]);
  carregarAtual.current = carregar;
  useEffect(() => { montado.current = true; void carregar(); return () => { montado.current = false; controle.current?.abort(); }; }, [carregar]);
  async function tratarErro(erro: unknown) {
    if (!montado.current || !(erro instanceof ApiError)) return;
    if (["MEMBERSHIP_REQUIRED", "FORBIDDEN_CROSS_TENANT"].includes(erro.codigo)) await recarregarEstado();
    if (["CATEGORY_NOT_FOUND", "CATEGORY_INACTIVE"].includes(erro.codigo)) categorias.atualizar();
    if (erro.codigo === "PRODUCT_NOT_FOUND") { setAviso("O anúncio não está mais disponível para gestão. A lista foi atualizada."); await atualizarLista(); }
  }
  function filtrar(mudancas: { busca?: string; categoria?: string; ativo?: string; pagina?: number }) {
    const novos = { busca, categoria, ativo, pagina, ...mudancas };
    const params = new URLSearchParams({ pagina: String(novos.pagina) });
    if (novos.busca.trim()) params.set("busca", novos.busca.trim());
    if (novos.categoria) params.set("id_categoria", novos.categoria);
    if (novos.ativo) params.set("ativo", novos.ativo);
    setQuery(params);
  }
  function buscar(event: FormEvent) { event.preventDefault(); filtrar({ busca: textoBusca, pagina: 1 }); }
  if (!validacao.success) return <section className="card"><h1>Confira os filtros dos seus produtos</h1><Aviso erro>{validacao.error.issues[0]?.message}</Aviso><button className="botao-principal" onClick={() => setQuery({})}>Limpar filtros</button></section>;
  const temFiltro = Boolean(busca || categoria || ativo !== undefined);
  const foraDaPagina = resultado && resultado.paginacao.total > 0 && resultado.dados.length === 0;
  const voltar = `/meus-produtos?${query}`;
  return <section className="meus-produtos"><div className="titulo-vitrine linha"><div><p className="sobretitulo">SEUS ANÚNCIOS</p><h1>Meus Produtos</h1><p>Publique e cuide dos produtos que oferece à vizinhança.</p></div><Link className="botao-principal" to="/meus-produtos/novo" state={{ voltar }}>Novo produto</Link></div>
    <div className="card filtros-gestao"><form className="busca-vitrine" onSubmit={buscar}><Campo id="busca-meus-produtos" label="Buscar meus produtos" type="search" maxLength={140} value={textoBusca} onChange={e => setTextoBusca(e.target.value)} /><button className="botao-principal">Buscar</button></form>
      <div className="duas-colunas"><div className="campo"><label htmlFor="categoria-gestao">Categoria</label><select id="categoria-gestao" value={categoria ?? ""} disabled={categorias.carregando || categorias.erro || categorias.categorias.length === 0} onChange={e => filtrar({ categoria: e.target.value, pagina: 1 })}><option value="">Todas</option>{categoria && !categorias.categorias.some(item => item.id_categoria === categoria) && <option value={categoria}>Categoria selecionada indisponível</option>}{categorias.categorias.map(item => <option key={item.id_categoria} value={item.id_categoria}>{item.nome}</option>)}</select></div>
      <div className="campo"><label htmlFor="status-gestao">Status</label><select id="status-gestao" value={ativo ?? ""} onChange={e => filtrar({ ativo: e.target.value, pagina: 1 })}><option value="">Todos</option><option value="true">Ativos</option><option value="false">Inativos</option></select></div></div>
      {categorias.carregando && <p role="status">Carregando categorias…</p>}{categorias.erro && <Aviso erro>Não foi possível carregar categorias. <button className="botao-texto" onClick={categorias.atualizar}>Tentar categorias novamente</button></Aviso>}
      {!categorias.carregando && !categorias.erro && categorias.categorias.length === 0 && <p>Nenhuma categoria ativa disponível. Seus anúncios existentes continuam nesta lista.</p>}
      <div className="acoes-produto">{temFiltro && <button className="botao-texto" onClick={() => { setTextoBusca(""); setQuery({}); }}>Limpar filtros</button>}<button className="botao-texto" disabled={carregando} onClick={() => void carregar()}>Atualizar lista</button></div>
    </div>
    {aviso && <Aviso>{aviso}</Aviso>}{erro && <Aviso erro>Não foi possível carregar seus produtos. <button className="botao-texto" onClick={() => void carregar()}>Tentar novamente</button></Aviso>}
    {carregando && <p role="status">{resultado ? "Atualizando seus produtos…" : "Carregando seus produtos…"}</p>}
    {!carregando && !erro && resultado?.dados.length === 0 && <div className="card estado-vazio"><h2>{foraDaPagina ? "Nenhum anúncio nesta página" : temFiltro ? "Nenhum anúncio para estes filtros" : "Você ainda não publicou produtos"}</h2><p>{foraDaPagina ? "Volte à primeira página para ver a lista atualizada." : temFiltro ? "Altere os filtros para encontrar seus anúncios." : "Comece com seu primeiro anúncio para o condomínio."}</p>{foraDaPagina && <button className="botao-secundario" onClick={() => filtrar({ pagina: 1 })}>Ir para a primeira página</button>}</div>}
    <div className="grade-produtos" aria-busy={carregando}>{resultado?.dados.map(produto => <article className="produto-card" key={produto.id_produto} aria-label={`Gerenciar ${produto.nome_produto}`}><ImagemProduto url={produto.imagens[0]?.url} nome={produto.nome_produto} /><div className="produto-card-conteudo"><span className="categoria-produto">{produto.categoria.nome}</span><h2>{produto.nome_produto}</h2><p className="preco">{formatarReais(produto.preco)}</p><p className="estoque">{produto.estoque} em estoque</p><span className="etiqueta">{produto.ativo ? "Ativo" : "Inativo"}</span>{!produto.categoria.ativo && <p className="ajuda">Categoria inativa. Você pode editar ou desativar este anúncio.</p>}<div className="acoes-produto"><Link className="botao-secundario" to={`/meus-produtos/${produto.id_produto}/editar`} state={{ voltar }}>Editar</Link><AcaoStatusProduto id={produto.id_produto} ativo={produto.ativo} bloqueado={carregando || erro} atualizar={atualizarLista} aoErro={tratarErro} /></div></div></article>)}</div>
    {!erro && resultado && resultado.paginacao.total_paginas > 0 && !foraDaPagina && <nav className="paginacao paginacao-produtos" aria-label="Paginação dos meus produtos"><button className="botao-secundario" disabled={carregando || pagina <= 1} onClick={() => filtrar({ pagina: pagina - 1 })}>Anterior</button><span>Página {resultado.paginacao.pagina} de {resultado.paginacao.total_paginas}</span><button className="botao-secundario" disabled={carregando || pagina >= resultado.paginacao.total_paginas} onClick={() => filtrar({ pagina: pagina + 1 })}>Próxima</button></nav>}
  </section>;
}
