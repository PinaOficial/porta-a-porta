import { useEffect, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { ApiError, type ListaPaginada } from "../../lib/api";
import { Campo, Aviso } from "../../components/ui/Campo";
import { useEstadoUsuario } from "../perfil/EstadoUsuarioProvider";
import { listarCategorias, listarProdutos } from "./produto.api";
import { lerFiltrosVitrine } from "./produto.schema";
import type { Categoria, ProdutoVitrine } from "./produto.types";
import { ProdutoCard } from "./ProdutoCard";

export function VitrinePage() {
  const [query, setQuery] = useSearchParams();
  const validacao = lerFiltrosVitrine(query);
  const filtros = validacao.success ? validacao.data : null;
  const busca = filtros?.busca ?? "";
  const categoria = filtros?.id_categoria ?? "";
  const pagina = filtros?.pagina ?? 1;
  const [textoBusca, setTextoBusca] = useState(busca);
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [carregandoCategorias, setCarregandoCategorias] = useState(true);
  const [erroCategorias, setErroCategorias] = useState(false);
  const [tentativaCategorias, setTentativaCategorias] = useState(0);
  const [resultado, setResultado] = useState<ListaPaginada<ProdutoVitrine> | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState(false);
  const [tentativa, setTentativa] = useState(0);
  const { recarregarEstado } = useEstadoUsuario();
  const queryValida = validacao.success;
  useEffect(() => setTextoBusca(busca), [busca]);
  useEffect(() => {
    const abort = new AbortController();
    setCarregandoCategorias(true); setErroCategorias(false);
    void listarCategorias(abort.signal).then(resposta => {
      if (!abort.signal.aborted) setCategorias(resposta.dados);
    }).catch(erro => {
      if (!abort.signal.aborted) {
        setErroCategorias(true);
        if (erro instanceof ApiError && ["MEMBERSHIP_REQUIRED", "FORBIDDEN_CROSS_TENANT"].includes(erro.codigo)) void recarregarEstado();
      }
    }).finally(() => { if (!abort.signal.aborted) setCarregandoCategorias(false); });
    return () => abort.abort();
  }, [tentativaCategorias, recarregarEstado]);
  useEffect(() => {
    if (!queryValida) return;
    const abort = new AbortController();
    setCarregando(true); setErro(false);
    void listarProdutos({ busca, id_categoria: categoria || undefined, pagina }, abort.signal).then(resposta => {
      if (!abort.signal.aborted) setResultado(resposta);
    }).catch(erro => {
      if (!abort.signal.aborted) {
        setErro(true);
        if (erro instanceof ApiError && ["MEMBERSHIP_REQUIRED", "FORBIDDEN_CROSS_TENANT"].includes(erro.codigo)) void recarregarEstado();
      }
    }).finally(() => { if (!abort.signal.aborted) setCarregando(false); });
    return () => abort.abort();
  }, [busca, categoria, pagina, tentativa, queryValida, recarregarEstado]);
  function alterarFiltros(mudancas: { busca?: string; id_categoria?: string; pagina?: number }) {
    const novos = { busca, id_categoria: categoria, pagina, ...mudancas };
    const params = new URLSearchParams();
    if (novos.busca.trim()) params.set("busca", novos.busca.trim());
    if (novos.id_categoria) params.set("id_categoria", novos.id_categoria);
    params.set("pagina", String(novos.pagina));
    setQuery(params);
  }
  function buscar(event: FormEvent) {
    event.preventDefault();
    alterarFiltros({ busca: textoBusca.trim(), pagina: 1 });
  }
  if (!validacao.success) return <section className="card"><h1>Confira os filtros da vitrine</h1><Aviso erro>{validacao.error.issues[0]?.message}</Aviso><button className="botao-principal" onClick={() => setQuery({})}>Limpar filtros</button></section>;
  const temFiltro = Boolean(busca || categoria);
  const foraDaPagina = resultado && resultado.paginacao.total > 0 && resultado.dados.length === 0;
  return <section className="vitrine" aria-labelledby="titulo-vitrine">
    <div className="titulo-vitrine"><div><p className="sobretitulo">DE VIZINHO PARA VIZINHO</p><h1 id="titulo-vitrine">Encontre pertinho de você</h1><p>Produtos de quem compartilha sua vizinhança.</p></div></div>
    <div className="card filtros-vitrine"><form onSubmit={buscar} className="busca-vitrine"><Campo id="busca-produto" label="Buscar produto" type="search" maxLength={140} placeholder="O que você procura?" value={textoBusca} onChange={e => setTextoBusca(e.target.value)} /><button className="botao-principal" type="submit">Buscar</button></form>
      <div className="campo"><label htmlFor="categoria-produto">Categoria</label><select id="categoria-produto" value={categoria} disabled={carregandoCategorias || erroCategorias || categorias.length === 0} onChange={e => alterarFiltros({ id_categoria: e.target.value, pagina: 1 })}>
        <option value="">Todos</option>{categoria && !categorias.some(item => item.id_categoria === categoria) && <option value={categoria}>Categoria selecionada indisponível</option>}{categorias.map(item => <option key={item.id_categoria} value={item.id_categoria}>{item.nome}</option>)}
      </select></div>
      {carregandoCategorias && <p role="status">Carregando categorias…</p>}
      {erroCategorias && <Aviso erro>Não foi possível carregar as categorias. <button className="botao-texto" onClick={() => setTentativaCategorias(t => t + 1)}>Tentar categorias novamente</button></Aviso>}
      {!carregandoCategorias && !erroCategorias && categorias.length === 0 && <p>Não há categorias disponíveis para filtrar. Você pode ver todos os produtos.</p>}
      {temFiltro && <button className="botao-texto" onClick={() => { setTextoBusca(""); setQuery({}); }}>Limpar filtros</button>}
    </div>
    {erro && <Aviso erro>Não foi possível carregar os produtos. <button className="botao-texto" onClick={() => setTentativa(t => t + 1)}>Tentar novamente</button></Aviso>}
    {carregando && <p role="status">{resultado ? "Atualizando produtos…" : "Carregando produtos…"}</p>}
    {!carregando && !erro && resultado?.dados.length === 0 && <div className="card estado-vazio">
      <h2>{foraDaPagina ? "Nenhum produto nesta página" : temFiltro ? "Nenhum resultado para estes filtros" : "Ainda não há produtos por aqui"}</h2>
      <p>{foraDaPagina ? "A lista mudou. Volte à primeira página para continuar." : temFiltro ? "Tente outro nome ou escolha uma categoria diferente." : "Os anúncios publicados pelos moradores aparecerão nesta vitrine."}</p>
      {foraDaPagina && <button className="botao-secundario" onClick={() => alterarFiltros({ pagina: 1 })}>Ir para a primeira página</button>}
    </div>}
    <div className="grade-produtos" aria-busy={carregando}>{resultado?.dados.map(produto => <ProdutoCard key={produto.id_produto} produto={produto} voltar={`/vitrine?${query}`} />)}</div>
    {!erro && resultado && resultado.paginacao.total_paginas > 0 && !foraDaPagina && <nav className="paginacao paginacao-produtos" aria-label="Paginação dos produtos">
      <button className="botao-secundario" disabled={carregando || pagina <= 1} onClick={() => alterarFiltros({ pagina: pagina - 1 })}>Anterior</button><span>Página {resultado.paginacao.pagina} de {resultado.paginacao.total_paginas}</span><button className="botao-secundario" disabled={carregando || pagina >= resultado.paginacao.total_paginas} onClick={() => alterarFiltros({ pagina: pagina + 1 })}>Próxima</button>
    </nav>}
  </section>;
}
