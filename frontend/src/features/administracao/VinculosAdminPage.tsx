import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Aviso, Campo } from "../../components/ui/Campo";
import { ApiError, type ListaPaginada } from "../../lib/api";
import { formatarDataHora } from "../../lib/data";
import { useEstadoUsuario } from "../perfil/EstadoUsuarioProvider";
import { SeletorCondominio } from "../condominios/SeletorCondominio";
import type { Condominio } from "../condominios/condominio.types";
import * as client from "./administracao.api";
import { lerFiltrosAdministracao, statusVinculoSchema } from "./administracao.schema";
import { mensagemErroAdmin, podeAlterarAdmin } from "./administracao.regras";
import type { ItemAdministrativo, StatusConta } from "./administracao.types";

type Acao = "aprovar" | "rejeitar" | "suspender" | "admin" | "suspender-conta" | "reativar-conta";
const nomes: Record<Acao, string> = { aprovar: "Aprovar", rejeitar: "Rejeitar", suspender: "Suspender vínculo", admin: "Alterar administrador", "suspender-conta": "Suspender conta", "reativar-conta": "Reativar conta" };
function confirmacao(acao: Acao, item: ItemAdministrativo) {
  const pessoa = `${item.morador.nome_completo} — ${item.moradia}, ${item.condominio.nome_residencial}`;
  const mensagens: Record<Acao, string> = {
    aprovar: "Aprovar esta solicitação? Se for uma transferência, a aprovação encerra a residência antiga e desativa seus anúncios antigos. O servidor verifica pedidos abertos e a regra do último administrador.",
    rejeitar: "Rejeitar esta solicitação? Em uma transferência, a residência atual permanece como está.",
    suspender: "Suspender este vínculo? O morador perde acesso às ações que exigem residência ATIVA. Pedidos e chats históricos são preservados. A conta global não será suspensa.",
    admin: "admin_condominio" in item && item.admin_condominio ? "Remover o privilégio de administrador deste vínculo?" : "Conceder administração local a este vínculo?",
    "suspender-conta": "Suspender a conta GLOBAL? A API protegida negará chamadas futuras mesmo com JWT válido. Os vínculos locais e o histórico não serão alterados.",
    "reativar-conta": "Reativar a conta GLOBAL? Isso libera apenas a conta; não reativa automaticamente vínculos locais.",
  };
  return `${mensagens[acao]}\n\n${pessoa}`;
}
export function VinculosAdminPage({ pendentes = false }: { pendentes?: boolean }) {
  const { meuUsuario, situacaoResidencial, recarregarEstado } = useEstadoUsuario();
  const superAdmin = meuUsuario?.super_admin === true;
  const atual = situacaoResidencial?.vinculo_ativo;
  const navigate = useNavigate();
  const [query, setQuery] = useSearchParams();
  const validacao = lerFiltrosAdministracao(query, pendentes);
  const filtros = validacao.success ? validacao.data : null;
  const pagina = filtros?.pagina ?? 1, busca = filtros?.busca, idCondominio = filtros?.id_condominio;
  const status = filtros?.status;
  const foraEscopo = !superAdmin && Boolean(idCondominio && idCondominio !== atual?.condominio.id_condominio);
  const valida = validacao.success && !foraEscopo;
  const [texto, setTexto] = useState(busca ?? "");
  const [selecao, setSelecao] = useState<Condominio | null>(null);
  const [resultado, setResultado] = useState<ListaPaginada<ItemAdministrativo> | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");
  const [aviso, setAviso] = useState<{ texto: string; erro?: boolean } | null>(null);
  // Resultado confirmado pelo PATCH, por identidade global, compartilhado entre vínculos repetidos.
  const [contas, setContas] = useState<Record<string, StatusConta>>({});
  const [ocupados, setOcupados] = useState<Set<string>>(new Set());
  const travas = useRef(new Set<string>());
  const montado = useRef(false), controle = useRef<AbortController | null>(null);
  const carregarAtual = useRef<() => Promise<void>>(async () => {});
  const filtrosAtuais = useRef(query); filtrosAtuais.current = query;
  useEffect(() => setTexto(busca ?? ""), [busca]);
  const negar = useCallback(async (falha: unknown) => {
    if (!montado.current) return;
    setResultado(null);
    navigate("/perfil", { replace: true, state: { aviso: mensagemErroAdmin(falha) } });
    await recarregarEstado();
  }, [navigate, recarregarEstado]);
  const carregar = useCallback(async () => {
    controle.current?.abort();
    if (!valida || !montado.current) return;
    const abort = new AbortController(); controle.current = abort;
    setCarregando(true); setErro(""); setResultado(null);
    try {
      const params = { pagina, ...(busca ? { busca } : {}), ...(status ? { status } : {}), ...(superAdmin && idCondominio ? { id_condominio: idCondominio } : {}) };
      const resposta = await (pendentes ? client.listarVinculosPendentes(params, abort.signal) : client.listarVinculosAdmin(params, abort.signal));
      if (abort.signal.aborted) return;
      const ultima = Math.max(1, resposta.paginacao.total_paginas);
      if (pagina > ultima) { const novos = new URLSearchParams(filtrosAtuais.current); novos.set("pagina", String(ultima)); setQuery(novos, { replace: true }); return; }
      setResultado(resposta);
    } catch (falha) {
      if (abort.signal.aborted) return;
      if (falha instanceof ApiError && falha.status === 403 && falha.codigo !== "ACCOUNT_SUSPENDED") await negar(falha);
      else setErro(falha instanceof ApiError && falha.codigo === "VALIDATION_ERROR" ? mensagemErroAdmin(falha) : "Não foi possível carregar os vínculos. Tente novamente.");
    } finally { if (!abort.signal.aborted && montado.current) setCarregando(false); }
  }, [valida, pagina, busca, status, superAdmin, idCondominio, pendentes, setQuery, negar]);
  carregarAtual.current = carregar;
  useEffect(() => { montado.current = true; void carregar(); return () => { montado.current = false; controle.current?.abort(); }; }, [carregar]);
  function filtrar(campo: string, valor: string) {
    const novos = new URLSearchParams(query); novos.set("pagina", "1");
    if (valor) novos.set(campo, valor); else novos.delete(campo);
    setQuery(novos);
  }
  function buscar(event: FormEvent) { event.preventDefault(); filtrar("busca", texto.trim()); }
  async function agir(acao: Acao, item: ItemAdministrativo) {
    const idUsuario = "id_usuario" in item.morador ? item.morador.id_usuario : item.morador.id_condomino;
    const global = acao === "suspender-conta" || acao === "reativar-conta";
    const chave = `vinculo:${item.id_vinculo}`, conta = `conta:${idUsuario}`;
    if (carregando || erro || travas.current.has(chave) || travas.current.has(conta) || global && (!superAdmin || !("id_usuario" in item.morador))) return;
    if (!window.confirm(confirmacao(acao, item))) return;
    travas.current.add(chave); if (global) travas.current.add(conta);
    setOcupados(new Set(travas.current)); setAviso(null);
    try {
      if (acao === "aprovar") await client.aprovarVinculo(item.id_vinculo);
      else if (acao === "rejeitar") await client.rejeitarVinculo(item.id_vinculo);
      else if (acao === "suspender") await client.suspenderVinculo(item.id_vinculo);
      else if (acao === "admin" && "admin_condominio" in item) await client.alterarAdminVinculo(item.id_vinculo, !item.admin_condominio);
      else if (global) {
        const resposta = await client.alterarStatusConta(idUsuario, acao === "suspender-conta" ? "SUSPENSA" : "ATIVA");
        if (montado.current) setContas(anteriores => ({ ...anteriores, [resposta.dados.id_usuario]: resposta.dados.status_conta }));
      }
      if (!montado.current) return;
      setAviso({ texto: `${nomes[acao]}: alteração confirmada para ${item.morador.nome_completo}.` });
      if (idUsuario === meuUsuario?.id_usuario) { await recarregarEstado(); return; }
      await carregarAtual.current();
    } catch (falha) {
      if (!montado.current) return;
      if (falha instanceof ApiError && falha.status === 403 && falha.codigo !== "ACCOUNT_SUSPENDED") { await negar(falha); return; }
      setAviso({ texto: mensagemErroAdmin(falha), erro: true });
      if (falha instanceof ApiError && falha.codigo === "USER_NOT_FOUND") setContas(anteriores => { const novos = { ...anteriores }; delete novos[idUsuario]; return novos; });
      if (falha instanceof ApiError && [404, 409].includes(falha.status)) await carregarAtual.current();
    } finally {
      travas.current.delete(chave); if (global) travas.current.delete(conta);
      if (montado.current) setOcupados(new Set(travas.current));
    }
  }
  if (!validacao.success || foraEscopo) return <section className="card"><h1>Confira os filtros administrativos</h1><Aviso erro>{foraEscopo ? "Você administra apenas seu condomínio. Este filtro está fora do seu escopo." : validacao.error?.issues[0]?.message}</Aviso><button className="botao-principal" onClick={() => setQuery({})}>Limpar filtros</button></section>;
  return <section className="administracao"><Link to="/admin" className="voltar-vitrine">← Administração</Link>
    <div className="titulo-vitrine linha"><div><h1>{pendentes ? "Solicitações pendentes" : "Moradores e vínculos"}</h1><p>{superAdmin ? "Escopo global; o filtro de condomínio é opcional." : `Condomínio: ${atual?.condominio.nome_residencial}`}</p></div><button className="botao-secundario" disabled={carregando} onClick={() => void carregarAtual.current()}>Atualizar vínculos</button></div>
    <nav className="navegacao abas-admin" aria-label="Seções administrativas"><Link to="/admin/vinculos/pendentes" aria-current={pendentes ? "page" : undefined}>Solicitações pendentes</Link><Link to="/admin/vinculos" aria-current={!pendentes ? "page" : undefined}>Moradores e vínculos</Link></nav>
    <div className="card filtros-admin"><form onSubmit={buscar} className="busca-vitrine"><Campo id="busca-admin" label="Buscar por nome ou moradia" maxLength={160} type="search" value={texto} onChange={e => setTexto(e.target.value)} /><button className="botao-secundario">Buscar</button></form>
      {!pendentes && <div className="campo"><label htmlFor="status-vinculo-admin">Status do vínculo</label><select id="status-vinculo-admin" value={status ?? ""} onChange={e => filtrar("status", e.target.value)}><option value="">Todos</option>{statusVinculoSchema.options.map(valor => <option key={valor}>{valor}</option>)}</select></div>}
      {superAdmin && <details><summary>Filtrar por condomínio</summary>{idCondominio && <p className="pedido-identificador">Filtro atual: {selecao?.id_condominio === idCondominio ? selecao.nome_residencial : idCondominio}</p>}<SeletorCondominio selecionado={selecao?.id_condominio === idCondominio ? selecao : null} selecionar={condominio => { setSelecao(condominio); filtrar("id_condominio", condominio.id_condominio); }} /><button className="botao-texto" onClick={() => { setSelecao(null); filtrar("id_condominio", ""); }}>Todos os condomínios</button></details>}
      {(busca || status || idCondominio) && <button className="botao-texto" onClick={() => { setSelecao(null); setQuery({}); }}>Limpar filtros</button>}
    </div>
    {aviso && <Aviso erro={aviso.erro}>{aviso.texto}</Aviso>}{erro && <Aviso erro>{erro} <button className="botao-texto" onClick={() => void carregarAtual.current()}>Tentar novamente</button></Aviso>}{carregando && <p role="status">Carregando vínculos…</p>}
    {!carregando && !erro && resultado?.dados.length === 0 && <div className="card estado-vazio"><h2>{busca || status || idCondominio ? "Nenhum vínculo para estes filtros" : pendentes ? "Nenhuma solicitação pendente" : "Nenhum vínculo encontrado"}</h2><p>Atualize a lista ou ajuste os filtros para consultar outros resultados.</p></div>}
    <div className="lista-admin" aria-busy={carregando}>{resultado?.dados.map(item => {
      const geral = "admin_condominio" in item;
      const idUsuario = "id_usuario" in item.morador ? item.morador.id_usuario : item.morador.id_condomino;
      const bloqueado = carregando || Boolean(erro) || ocupados.has(`vinculo:${item.id_vinculo}`) || ocupados.has(`conta:${idUsuario}`);
      const acoes: Acao[] = item.status_vinculo === "PENDENTE" ? ["aprovar", "rejeitar"] : item.status_vinculo === "ATIVO" ? ["suspender", ...(podeAlterarAdmin(item, superAdmin, atual?.id_vinculo) ? ["admin" as const] : [])] : [];
      return <article className="card vinculo-admin" key={item.id_vinculo} aria-label={`Vínculo de ${item.morador.nome_completo}`}><div className="linha"><h2>{item.morador.nome_completo}</h2><span className="etiqueta">{item.status_vinculo}</span></div>
        <dl className="detalhes"><dt>Moradia</dt><dd>{item.moradia}</dd><dt>Condomínio</dt><dd>{item.condominio.nome_residencial}</dd><dt>Solicitação</dt><dd>{formatarDataHora(item.data_solicitacao)}</dd>{geral && <><dt>Administração local</dt><dd>{item.admin_condominio ? "Administrador" : "Morador"}</dd>{item.data_inicio && <><dt>Início do vínculo</dt><dd>{formatarDataHora(item.data_inicio)}</dd></>}</>}</dl>
        <div className="acoes-admin">{acoes.map(acao => <button key={acao} className="botao-secundario" disabled={bloqueado} onClick={() => void agir(acao, item)}>{acao === "admin" && geral ? item.admin_condominio ? "Remover administrador" : "Tornar administrador" : nomes[acao]}</button>)}</div>
        {superAdmin && geral && <div className="conta-global"><h3>Ações globais de conta</h3><p className="ajuda">Estas ações afetam a conta em todos os condomínios. A lista de vínculos não informa o status global atual.</p>{contas[idUsuario] && <p role="status">Última alteração confirmada nesta sessão: conta {contas[idUsuario]}.</p>}<div className="acoes-admin">{(["suspender-conta", "reativar-conta"] as const).map(acao => <button key={acao} className="botao-secundario" disabled={bloqueado} onClick={() => void agir(acao, item)}>{nomes[acao]}</button>)}</div></div>}
        {ocupados.has(`vinculo:${item.id_vinculo}`) && <p role="status">Salvando alteração…</p>}
      </article>;
    })}</div>
    {!erro && resultado && resultado.paginacao.total_paginas > 0 && <nav className="paginacao paginacao-produtos" aria-label="Paginação dos vínculos"><button className="botao-secundario" disabled={carregando || pagina <= 1} onClick={() => { const novos = new URLSearchParams(query); novos.set("pagina", String(pagina - 1)); setQuery(novos); }}>Anterior</button><span>Página {resultado.paginacao.pagina} de {resultado.paginacao.total_paginas} · {resultado.paginacao.total} vínculos</span><button className="botao-secundario" disabled={carregando || pagina >= resultado.paginacao.total_paginas} onClick={() => { const novos = new URLSearchParams(query); novos.set("pagina", String(pagina + 1)); setQuery(novos); }}>Próxima</button></nav>}
  </section>;
}
