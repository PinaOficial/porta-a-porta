import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ApiError, type ListaPaginada } from "../../lib/api";
import { Aviso } from "../../components/ui/Campo";
import { formatarReais } from "../../lib/moeda";
import { formatarDataHora } from "../../lib/data";
import { useAuth } from "../auth/AuthProvider";
import { listarMeusPedidos } from "./pedido.api";
import { lerFiltrosPedidos } from "./pedido.schema";
import { nomesStatusPedido } from "./pedido.regras";
import type { MeuPedido } from "./pedido.types";
import { AcaoPedido } from "./AcaoPedido";

export function MeusPedidosPage() {
  const [query, setQuery] = useSearchParams();
  const validacao = lerFiltrosPedidos(query);
  const papel = validacao.success ? validacao.data.papel : undefined;
  const status = validacao.success ? validacao.data.status : undefined;
  const pagina = validacao.success ? validacao.data.pagina : 1;
  const valida = validacao.success;
  const { usuario } = useAuth();
  const [resultado, setResultado] = useState<ListaPaginada<MeuPedido> | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");
  const [aviso, setAviso] = useState<{ mensagem: string; erro: boolean } | null>(null);
  const [indisponiveis, setIndisponiveis] = useState<Set<string>>(new Set());
  const controle = useRef<AbortController | null>(null);
  const montado = useRef(false);
  const carregarAtual = useRef<() => Promise<void>>(async () => {});
  const atualizar = useCallback(() => carregarAtual.current(), []);
  function parametros(novoPapel: string | undefined, novoStatus: string | undefined, novaPagina: number) {
    const params = new URLSearchParams({ pagina: String(novaPagina) });
    if (novoPapel) params.set("papel", novoPapel);
    if (novoStatus) params.set("status", novoStatus);
    return params;
  }
  const carregar = useCallback(async () => {
    controle.current?.abort();
    if (!valida || !montado.current) return;
    const abort = new AbortController(); controle.current = abort;
    setCarregando(true); setErro("");
    try {
      const resposta = await listarMeusPedidos({ papel, status, pagina }, abort.signal);
      if (abort.signal.aborted) return;
      const ultima = Math.max(1, resposta.paginacao.total_paginas);
      if (pagina > ultima) { setQuery(parametros(papel, status, ultima), { replace: true }); return; }
      setResultado(resposta);
    } catch (erro) {
      if (!abort.signal.aborted) {
        if (erro instanceof ApiError && erro.codigo === "CONDOMINO_PROFILE_REQUIRED") { setResultado(null); setErro("Sua conta não possui o perfil necessário para consultar pedidos próprios."); }
        else setErro("Não foi possível carregar seus pedidos. Verifique sua conexão e tente novamente.");
      }
    } finally { if (!abort.signal.aborted) setCarregando(false); }
  }, [valida, papel, status, pagina, setQuery]);
  carregarAtual.current = carregar;
  useEffect(() => { montado.current = true; void carregar(); return () => { montado.current = false; controle.current?.abort(); }; }, [carregar]);
  const informar = useCallback((mensagem: string, erro = false) => { if (montado.current) setAviso({ mensagem, erro }); }, []);
  if (!validacao.success) return <section className="card"><h1>Confira os filtros dos pedidos</h1><Aviso erro>{validacao.error.issues[0]?.message}</Aviso><button className="botao-principal" onClick={() => setQuery({})}>Limpar filtros</button></section>;
  return <section className="meus-pedidos"><div className="titulo-vitrine linha"><div><p className="sobretitulo">SUAS NEGOCIAÇÕES</p><h1>Meus Pedidos</h1><p>Compras e vendas, incluindo seus pedidos em condomínios anteriores.</p></div><button className="botao-secundario" disabled={carregando} onClick={() => void atualizar()}>Atualizar pedidos</button></div>
    <div className="card filtros-pedidos"><div className="abas-pedidos" role="group" aria-label="Papel nos pedidos">{[{ valor: "", nome: "Todos" }, { valor: "compra", nome: "Compras" }, { valor: "venda", nome: "Vendas" }].map(aba => <button className="botao-secundario" key={aba.valor} aria-pressed={(papel ?? "") === aba.valor} onClick={() => setQuery(parametros(aba.valor, status, 1))}>{aba.nome}</button>)}</div><div className="campo"><label htmlFor="status-pedidos">Status do pedido</label><select id="status-pedidos" value={status ?? ""} onChange={e => setQuery(parametros(papel, e.target.value, 1))}><option value="">Todos</option>{Object.entries(nomesStatusPedido).map(([valor, nome]) => <option value={valor} key={valor}>{nome}</option>)}</select></div>{(papel || status) && <button className="botao-texto" onClick={() => setQuery({})}>Limpar filtros</button>}</div>
    {aviso && <Aviso erro={aviso.erro}>{aviso.mensagem}</Aviso>}{erro && <Aviso erro>{erro} <button className="botao-texto" onClick={() => void atualizar()}>Tentar novamente</button></Aviso>}{carregando && <p role="status">{resultado ? "Atualizando pedidos…" : "Carregando pedidos…"}</p>}
    {!carregando && !erro && resultado?.dados.length === 0 && <div className="card estado-vazio"><h2>{papel || status ? "Nenhum pedido para estes filtros" : "Você ainda não tem pedidos"}</h2><p>{papel || status ? "Altere os filtros para consultar outras negociações." : "Suas compras e vendas aparecerão aqui."}</p></div>}
    <div className="lista-pedidos" aria-busy={carregando}>{resultado?.dados.map(pedido => indisponiveis.has(pedido.id_pedido) ? <article className="card" key={pedido.id_pedido}><h2>Pedido indisponível</h2></article> : <article className="card pedido-card" key={pedido.id_pedido} aria-label={`Pedido ${pedido.produto.nome_produto}`}>
      <div className="linha"><div><span className="categoria-produto">{pedido.papel_usuario === "COMPRADOR" ? "Compra" : "Venda"}</span><h2>{pedido.produto.nome_produto}</h2></div><span className="etiqueta">{nomesStatusPedido[pedido.status_pedido]}</span></div><p className="pedido-identificador">Pedido #{pedido.id_pedido}</p>
      <dl className="detalhes resumo-pedido"><dt>Quantidade</dt><dd>{pedido.quantidade}</dd><dt>Total registrado no pedido</dt><dd>{formatarReais(pedido.valor_pedido)}</dd><dt>{pedido.papel_usuario === "COMPRADOR" ? "Vendedor" : "Comprador"}</dt><dd>{pedido.contraparte.nome_completo}</dd><dt>Moradia da contraparte</dt><dd>{pedido.contraparte.moradia}</dd><dt>Condomínio da negociação</dt><dd>{pedido.condominio.nome_residencial}</dd><dt>Horário combinado</dt><dd><time dateTime={pedido.hora_combinada}>{formatarDataHora(pedido.hora_combinada)}</time></dd></dl>
      <details className="historico-pedido"><summary>Histórico do pedido</summary><p className="ajuda">Nome atual do produto; o total é o registrado na solicitação.</p><ol>{pedido.historico.map((evento, indice) => <li key={`${evento.created_at}-${indice}`}><strong>{evento.status_anterior ? `${nomesStatusPedido[evento.status_anterior]} → ` : ""}{nomesStatusPedido[evento.status_novo]}</strong><time dateTime={evento.created_at}>{formatarDataHora(evento.created_at)}</time>{evento.motivo && <p>{evento.motivo}</p>}</li>)}</ol></details>
      <AcaoPedido key={`${pedido.status_pedido}-${pedido.papel_usuario}-${pedido.ultima_atualizacao}`} pedido={pedido} bloqueado={carregando || Boolean(erro)} atualizar={atualizar} informar={informar} indisponivel={() => setIndisponiveis(atual => new Set(atual).add(pedido.id_pedido))} />
      {pedido.chat.disponivel ? <Link className="botao-secundario link-chat" to={`/pedidos/${pedido.id_pedido}/chat`} state={{ id_pedido: pedido.id_pedido, papel_usuario: pedido.papel_usuario, id_usuario: usuario?.id }}>Conversar</Link> : <p className="ajuda">Chat indisponível para este pedido.</p>}
    </article>)}</div>
    {!erro && resultado && resultado.paginacao.total_paginas > 0 && <nav className="paginacao paginacao-produtos" aria-label="Paginação dos pedidos"><button className="botao-secundario" disabled={carregando || pagina <= 1} onClick={() => setQuery(parametros(papel, status, pagina - 1))}>Anterior</button><span>Página {resultado.paginacao.pagina} de {resultado.paginacao.total_paginas} · {resultado.paginacao.total} pedidos</span><button className="botao-secundario" disabled={carregando || pagina >= resultado.paginacao.total_paginas} onClick={() => setQuery(parametros(papel, status, pagina + 1))}>Próxima</button></nav>}
  </section>;
}
