import { useEffect, useRef, useState, type FormEvent } from "react";
import { Aviso, Campo } from "../../components/ui/Campo";
import { ApiError } from "../../lib/api";
import { alterarStatusCondominioAdmin, editarCondominioAdmin, obterCondominioAdmin } from "../condominios/condominio.api";
import { criarCondominioSchema, statusCondominioSchema, type CriarCondominio } from "../condominios/condominio.schema";
import type { CondominioAdmin } from "../condominios/condominio.types";
import { useEstadoUsuario } from "../perfil/EstadoUsuarioProvider";

export function GestaoCondominioDialog({ id, status, fechar, sucesso }: {
  id: string; status: boolean; fechar: () => void; sucesso: (item: CondominioAdmin) => void;
}) {
  const { recarregarEstado } = useEstadoUsuario();
  const dialogo = useRef<HTMLDialogElement>(null), montado = useRef(false), trava = useRef(false);
  const [base, setBase] = useState<CondominioAdmin | null>(null);
  const [dados, setDados] = useState({ nome_residencial: "", cep: "", endereco: "" });
  const [motivo, setMotivo] = useState("");
  const [campos, setCampos] = useState<Record<string, string[] | undefined>>({});
  const [erro, setErro] = useState(""), [bloqueado, setBloqueado] = useState(false);
  const [carregando, setCarregando] = useState(true), [enviando, setEnviando] = useState(false), [revisao, setRevisao] = useState(0);
  function limparErro(campo: string) {
    setCampos(anteriores => {
      if (!(campo in anteriores)) return anteriores;
      const proximos = { ...anteriores };
      delete proximos[campo];
      return proximos;
    });
  }
  function alterarCampo(campo: keyof typeof dados, valor: string) {
    setDados(anteriores => ({ ...anteriores, [campo]: valor }));
    limparErro(campo);
  }
  useEffect(() => {
    montado.current = true;
    const origem = document.activeElement as HTMLElement | null;
    dialogo.current?.showModal();
    const elemento = dialogo.current;
    return () => { montado.current = false; elemento?.close(); origem?.focus(); };
  }, []);
  useEffect(() => {
    const abort = new AbortController(); setCarregando(true); setErro("");
    if (!/^[a-f0-9-]{36}$/i.test(id)) { setErro("Identificador de condomínio inválido."); setCarregando(false); return; }
    void obterCondominioAdmin(id, abort.signal).then(({ dados: item }) => {
      if (abort.signal.aborted) return;
      setBase(item); setDados({ nome_residencial: item.nome_residencial, cep: item.cep, endereco: item.endereco });
      setMotivo(""); setCampos({}); setBloqueado(false);
    }).catch(erro => {
      if (abort.signal.aborted) return;
      setErro(erro instanceof ApiError && erro.status === 404 ? "Condomínio não encontrado." : "Não foi possível carregar os dados. Confira sua sessão e tente novamente.");
      if (erro instanceof ApiError && [401, 403].includes(erro.status)) void recarregarEstado();
    }).finally(() => { if (!abort.signal.aborted) setCarregando(false); });
    return () => abort.abort();
  }, [id, revisao, recarregarEstado]);
  useEffect(() => {
    if (!carregando && base) dialogo.current?.querySelector<HTMLInputElement>("input:not(:disabled)")?.focus();
  }, [carregando, base]);
  async function salvar(event: FormEvent) {
    event.preventDefault(); if (!base || trava.current || bloqueado || carregando) return;
    setCampos({}); setErro("");
    const validacao = status ? statusCondominioSchema.safeParse({ motivo }) : criarCondominioSchema.safeParse(dados);
    if (!validacao.success) { setCampos(validacao.error.flatten().fieldErrors); return; }
    const alteracoes: Partial<CriarCondominio> = {};
    if (!status) for (const campo of ["nome_residencial", "cep", "endereco"] as const) {
      const valor = (validacao.data as CriarCondominio)[campo]; if (valor !== base[campo]) alteracoes[campo] = valor;
    }
    if (!status && Object.keys(alteracoes).length === 0) { setErro("Nenhuma alteração cadastral para salvar."); return; }
    trava.current = true; setEnviando(true);
    try {
      const resposta = status
        ? await alterarStatusCondominioAdmin(id, base.versao, !base.ativo, (validacao.data as { motivo: string }).motivo)
        : await editarCondominioAdmin(id, base.versao, alteracoes);
      if (montado.current) sucesso(resposta.dados);
    } catch (erro) {
      if (!montado.current) return;
      if (erro instanceof ApiError && erro.codigo === "CONDOMINIUM_UPDATE_CONFLICT") {
        setBloqueado(true); setErro("Os dados foram alterados por outra pessoa. Recarregue para revisar e confirmar novamente. Seu rascunho foi preservado até o recarregamento.");
      } else if (erro instanceof ApiError && erro.codigo === "VALIDATION_ERROR") {
        setCampos(erro.detalhes?.fieldErrors ?? {}); setErro("Confira os campos informados.");
      } else if (erro instanceof ApiError && [401, 403].includes(erro.status)) {
        setErro("Sua sessão ou permissão mudou. Atualizando acesso…"); await recarregarEstado();
      } else {
        setBloqueado(true); setErro("Não foi possível confirmar a alteração. Ela pode ter sido aplicada. Recarregue os dados para conferir antes de tentar novamente.");
      }
    } finally { trava.current = false; if (montado.current) setEnviando(false); }
  }
  return <dialog ref={dialogo} className="dialogo-condominio" aria-labelledby="gestao-condominio-titulo" onCancel={event => { event.preventDefault(); if (!trava.current) fechar(); }} onKeyDown={event => {
    if (event.key !== "Tab") return;
    const controles = [...event.currentTarget.querySelectorAll<HTMLElement>("input:not(:disabled), button:not(:disabled)")];
    const primeiro = controles[0], ultimo = controles.at(-1);
    if (event.shiftKey && document.activeElement === primeiro) { event.preventDefault(); ultimo?.focus(); }
    else if (!event.shiftKey && document.activeElement === ultimo) { event.preventDefault(); primeiro?.focus(); }
  }}>
    <h2 id="gestao-condominio-titulo">{status ? "Confirmar alteração de estado" : "Editar condomínio"}</h2>
    {carregando && <p role="status">Carregando condomínio…</p>}
    {erro && <Aviso erro>{erro}</Aviso>}
    {!carregando && (bloqueado || !base) && <button className="botao-secundario" onClick={() => setRevisao(v => v + 1)}>Recarregar dados do condomínio</button>}
    {base && <form onSubmit={event => void salvar(event)} noValidate>
      <p><strong>{base.nome_residencial}</strong> · Estado atual: {base.ativo ? "Ativo" : "Inativo"}</p>
      <fieldset disabled={enviando || carregando || bloqueado}>
        <legend>{status ? (base.ativo ? "Desativar condomínio" : "Reativar condomínio") : "Dados cadastrais"}</legend>
        {status ? <>
          <p>{base.ativo ? "Novas entradas residenciais, transferências para este destino e aprovações ficam bloqueadas. Moradores, anúncios, pedidos, conversas e históricos existentes são preservados." : "Novas entradas e análises de solicitações pendentes voltam a ser permitidas. Ninguém é aprovado automaticamente; suspensões e permissões são preservadas."}</p>
          <Campo id="motivo-estado-condominio" label="Motivo da alteração *" required maxLength={255} value={motivo} onChange={e => { setMotivo(e.target.value); limparErro("motivo"); }} erro={campos.motivo?.[0]} />
        </> : <>
          <Campo id="editar-nome-condominio" label="Nome do condomínio/residencial *" required maxLength={160} value={dados.nome_residencial} onChange={e => alterarCampo("nome_residencial", e.target.value)} erro={campos.nome_residencial?.[0]} />
          <Campo id="editar-cep-condominio" label="CEP *" required inputMode="numeric" autoComplete="postal-code" maxLength={9} value={dados.cep} onChange={e => alterarCampo("cep", e.target.value)} erro={campos.cep?.[0]} />
          <Campo id="editar-endereco-condominio" label="Endereço completo *" required maxLength={255} value={dados.endereco} onChange={e => alterarCampo("endereco", e.target.value)} erro={campos.endereco?.[0]} />
        </>}
        <button className="botao-principal">{enviando ? "Salvando…" : status ? (base.ativo ? "Confirmar desativação" : "Confirmar reativação") : "Salvar alterações"}</button>
      </fieldset>
    </form>}
    <button type="button" className="botao-secundario" disabled={enviando} onClick={fechar}>Cancelar</button>
  </dialog>;
}
