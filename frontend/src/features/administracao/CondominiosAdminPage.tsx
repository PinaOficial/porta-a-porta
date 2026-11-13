import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Aviso, Campo } from "../../components/ui/Campo";
import { ApiError, type ListaPaginada } from "../../lib/api";
import { criarCondominioAdmin, listarCondominiosAdmin } from "../condominios/condominio.api";
import { criarCondominioSchema } from "../condominios/condominio.schema";
import type { CondominioAdmin, CondominioCriado } from "../condominios/condominio.types";
import { GestaoCondominioDialog } from "./GestaoCondominioDialog";
import { useEstadoUsuario } from "../perfil/EstadoUsuarioProvider";

const vazio = { nome_residencial: "", cep: "", endereco: "" };
const formatarCep = (cep: string) => cep.replace(/^([0-9]{5})([0-9]{3})$/, "$1-$2");

export function CondominiosAdminPage() {
  const { recarregarEstado } = useEstadoUsuario();
  const [params, setParams] = useSearchParams();
  const atualizarParams = useRef(setParams); atualizarParams.current = setParams;
  const filtro = params.get("busca")?.trim() ?? "";
  const ativo = ["true", "false"].includes(params.get("ativo") ?? "") ? params.get("ativo")! : "";
  const editar = params.get("editar"), estado = params.get("estado");
  const numeroPagina = Number(params.get("pagina") ?? "1");
  const pagina = Number.isInteger(numeroPagina) && numeroPagina > 0 && numeroPagina <= 107374183 ? numeroPagina : 1;
  const [busca, setBusca] = useState(filtro);
  const [versao, setVersao] = useState(0);
  const [resultado, setResultado] = useState<ListaPaginada<CondominioAdmin> | null>(null);
  const [sucesso, setSucesso] = useState("");
  const [carregando, setCarregando] = useState(true);
  const [erroLista, setErroLista] = useState("");
  const [formulario, setFormulario] = useState(false);
  const [dados, setDados] = useState(vazio);
  const [campos, setCampos] = useState<Record<string, string[] | undefined>>({});
  const [erro, setErro] = useState("");
  const [incerto, setIncerto] = useState(false);
  const [criado, setCriado] = useState<CondominioCriado | null>(null);
  const [enviando, setEnviando] = useState(false);
  function alterarCampo(campo: keyof typeof dados, valor: string) {
    setDados(anteriores => ({ ...anteriores, [campo]: valor }));
    setCampos(anteriores => {
      if (!(campo in anteriores)) return anteriores;
      const proximos = { ...anteriores };
      delete proximos[campo];
      return proximos;
    });
  }
  const trava = useRef(false), montado = useRef(false);
  useEffect(() => { montado.current = true; return () => { montado.current = false; }; }, []);
  useEffect(() => { setBusca(filtro); }, [filtro]);
  useEffect(() => {
    const abort = new AbortController();
    setCarregando(true); setErroLista(""); setResultado(null);
    void listarCondominiosAdmin(filtro, pagina, ativo, abort.signal).then(resposta => {
      if (!abort.signal.aborted) {
        if (pagina > Math.max(1, resposta.paginacao.total_paginas)) {
          atualizarParams.current(anteriores => { const novos = new URLSearchParams(anteriores); novos.set("pagina", String(Math.max(1, resposta.paginacao.total_paginas))); return novos; }, { replace: true });
        } else setResultado(resposta);
      }
    }).catch(erro => {
      if (abort.signal.aborted) return;
      setErroLista("Não foi possível consultar os condomínios. Confira sua sessão e tente novamente.");
      if (erro instanceof ApiError && erro.status === 403) void recarregarEstado();
    }).finally(() => { if (!abort.signal.aborted) setCarregando(false); });
    return () => abort.abort();
  }, [filtro, pagina, ativo, versao, recarregarEstado]);

  function consultar(nome: string, proximaPagina = 1, estadoAtivo = ativo) {
    const novos = new URLSearchParams();
    if (nome.trim()) novos.set("busca", nome.trim());
    if (proximaPagina !== 1) novos.set("pagina", String(proximaPagina));
    if (estadoAtivo) novos.set("ativo", estadoAtivo);
    setParams(novos); setVersao(v => v + 1);
  }
  async function salvar(event: FormEvent) {
    event.preventDefault();
    if (trava.current || incerto) return;
    const validacao = criarCondominioSchema.safeParse(dados);
    setCampos({}); setErro("");
    if (!validacao.success) { setCampos(validacao.error.flatten().fieldErrors); return; }
    trava.current = true; setEnviando(true);
    try {
      const resposta = await criarCondominioAdmin(validacao.data);
      if (!montado.current) return;
      setCriado(resposta.dados); setFormulario(false); setDados(vazio);
      consultar(resposta.dados.nome_residencial, 1, "");
    } catch (erro) {
      if (!montado.current) return;
      if (erro instanceof ApiError && erro.codigo === "VALIDATION_ERROR") {
        setCampos(erro.detalhes?.fieldErrors ?? {}); setErro("Confira os campos do condomínio.");
      } else if (erro instanceof ApiError && erro.status === 403) {
        setErro("Sua conta não tem permissão para cadastrar condomínios. Atualizando seu acesso…");
        await recarregarEstado();
      } else if (!(erro instanceof ApiError) || erro.status === 0 || erro.status >= 500) {
        setIncerto(true);
        setErro("Não foi possível confirmar o cadastro. O condomínio pode ter sido criado. Consulte o catálogo antes de enviar novamente.");
      } else setErro("Não foi possível cadastrar. Confira sua sessão e tente novamente.");
    } finally { trava.current = false; if (montado.current) setEnviando(false); }
  }

  return <section className="administracao condominios-admin">
    <Link to="/admin" className="voltar-vitrine">← Administração</Link>
    <div className="titulo-vitrine"><h1>Condomínios</h1><p>Cadastro e gestão de condomínios ativos e inativos, exclusivos do super admin.</p></div>
    {sucesso && <Aviso>{sucesso}</Aviso>}
    {(editar || estado) && <GestaoCondominioDialog key={`${editar ?? estado}:${Boolean(estado)}`} id={(editar ?? estado)!} status={Boolean(estado)} fechar={() => setParams(anteriores => { const novos = new URLSearchParams(anteriores); novos.delete("editar"); novos.delete("estado"); return novos; })} sucesso={item => {
      setSucesso(`Condomínio ${item.nome_residencial} atualizado. Estado: ${item.ativo ? "Ativo" : "Inativo"}.`);
      setParams(anteriores => { const novos = new URLSearchParams(anteriores); novos.delete("editar"); novos.delete("estado"); return novos; });
      setVersao(v => v + 1);
    }} />}
    {criado && <Aviso><strong>Condomínio cadastrado: {criado.nome_residencial}</strong><p>CEP {formatarCep(criado.cep)} · {criado.endereco}</p><p>Ativo · ID {criado.id_condominio}</p><p>Os primeiros moradores podem solicitar acesso pelo onboarding. Aprove a solicitação e, se desejado, promova um morador ativo em Moradores e vínculos.</p></Aviso>}
    {!formulario && <button className="botao-principal" onClick={() => { setFormulario(true); setCriado(null); setCampos({}); setErro(""); setIncerto(false); }}>Cadastrar condomínio</button>}
    {formulario && <form className="card" onSubmit={e => void salvar(e)} noValidate><h2>Novo condomínio</h2>
      <fieldset disabled={enviando}><legend>Dados do condomínio</legend>
        <Campo id="nome-residencial" label="Nome do condomínio/residencial *" required maxLength={160} value={dados.nome_residencial} onChange={e => alterarCampo("nome_residencial", e.target.value)} erro={campos.nome_residencial?.[0]} />
        <Campo id="cep-condominio" label="CEP *" required inputMode="numeric" autoComplete="postal-code" maxLength={9} placeholder="00000-000" value={dados.cep} onChange={e => alterarCampo("cep", e.target.value)} erro={campos.cep?.[0]} />
        <Campo id="endereco-condominio" label="Endereço completo *" required autoComplete="street-address" maxLength={255} value={dados.endereco} onChange={e => alterarCampo("endereco", e.target.value)} erro={campos.endereco?.[0]} />
        {erro && <Aviso erro>{erro}</Aviso>}
        {incerto && <div><a className="botao-texto" href="#catalogo-condominios" onClick={() => consultar(dados.nome_residencial)}>Conferir cadastro no catálogo</a><button type="button" className="botao-secundario" onClick={() => { setIncerto(false); setErro(""); }}>Conferi o catálogo; liberar novo envio</button></div>}
        <div className="acoes-admin"><button className="botao-principal" disabled={enviando || incerto}>{enviando ? "Cadastrando…" : "Salvar condomínio"}</button><button type="button" className="botao-secundario" onClick={() => setFormulario(false)}>Cancelar</button></div>
      </fieldset>
    </form>}
    <section id="catalogo-condominios" className="card" aria-busy={carregando}>
      <h2>Consultar condomínios cadastrados</h2><p>Ativos e inativos, com busca por nome.</p>
      <div className="campo"><label htmlFor="estado-catalogo">Estado do condomínio</label><select id="estado-catalogo" value={ativo} onChange={e => consultar(filtro, 1, e.target.value)}><option value="">Todos</option><option value="true">Ativos</option><option value="false">Inativos</option></select></div>
      <form className="filtros-vitrine" onSubmit={e => { e.preventDefault(); consultar(busca); }}><Campo id="busca-catalogo" label="Buscar condomínio" type="search" maxLength={160} value={busca} onChange={e => setBusca(e.target.value)} /><button className="botao-secundario">Buscar</button><button type="button" className="botao-texto" onClick={() => setVersao(v => v + 1)}>Atualizar catálogo</button></form>
      {carregando && <p role="status">Consultando condomínios…</p>}
      {erroLista && <Aviso erro>{erroLista} <button className="botao-texto" onClick={() => setVersao(v => v + 1)}>Tentar novamente</button></Aviso>}
      {resultado?.dados.length === 0 && <p role="status">Nenhum condomínio encontrado nesta consulta.</p>}
      {resultado?.dados.map(item => <article className="card" key={item.id_condominio} aria-label={`Condomínio ${item.nome_residencial}`}><h3>{item.nome_residencial}</h3><p>Estado: {item.ativo ? "Ativo" : "Inativo"}</p><p>CEP {formatarCep(item.cep)}</p><p>{item.endereco}</p><div className="acoes-admin"><button className="botao-secundario" onClick={() => setParams(anteriores => { const novos = new URLSearchParams(anteriores); novos.delete("estado"); novos.set("editar", item.id_condominio); return novos; })}>Editar condomínio</button><button className="botao-secundario" onClick={() => setParams(anteriores => { const novos = new URLSearchParams(anteriores); novos.delete("editar"); novos.set("estado", item.id_condominio); return novos; })}>{item.ativo ? "Desativar condomínio" : "Reativar condomínio"}</button></div></article>)}
      {resultado && resultado.paginacao.total_paginas > 1 && <nav className="paginacao" aria-label="Paginação dos condomínios"><button className="botao-secundario" disabled={pagina === 1 || carregando} onClick={() => consultar(filtro, pagina - 1)}>Anterior</button><span>Página {pagina} de {resultado.paginacao.total_paginas}</span><button className="botao-secundario" disabled={pagina >= resultado.paginacao.total_paginas || carregando} onClick={() => consultar(filtro, pagina + 1)}>Próxima</button></nav>}
    </section>
  </section>;
}
