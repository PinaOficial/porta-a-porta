import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { useEstadoUsuario } from "../perfil/EstadoUsuarioProvider";
import { SeletorCondominio } from "../condominios/SeletorCondominio";
import type { Condominio } from "../condominios/condominio.types";
import { Aviso, Campo } from "../../components/ui/Campo";
import { ApiError } from "../../lib/api";
import { solicitarTransferencia } from "./vinculo.api";
import { transferenciaSchema } from "./vinculo.schema";

export function TransferenciaPage() {
  const { situacaoResidencial, recarregarEstado } = useEstadoUsuario();
  const navigate = useNavigate();
  const [destino, setDestino] = useState<Condominio | null>(null);
  const [moradia, setMoradia] = useState("");
  const [campos, setCampos] = useState<Record<string, string[] | undefined>>({});
  const [erro, setErro] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [versao, setVersao] = useState(0);
  const trava = useRef(false), montado = useRef(false);
  useEffect(() => { montado.current = true; return () => { montado.current = false; }; }, []);
  if (situacaoResidencial?.solicitacao_pendente) return <Navigate to="/perfil" replace />;
  async function enviar(event: FormEvent) {
    event.preventDefault(); if (trava.current) return;
    const validacao = transferenciaSchema.safeParse({ id_condominio: destino?.id_condominio ?? "", moradia });
    setCampos({}); setErro("");
    if (!validacao.success) { setCampos(validacao.error.flatten().fieldErrors); return; }
    trava.current = true; setEnviando(true);
    try {
      await solicitarTransferencia(validacao.data);
      if (!montado.current) return;
      navigate("/perfil", { replace: true, state: { aviso: "Transferência solicitada — aguardando aprovação" } });
      await recarregarEstado();
    } catch (erro) {
      if (!montado.current) return;
      const codigo = erro instanceof ApiError ? erro.codigo : "";
      if (codigo === "MEMBERSHIP_REQUIRED" || codigo === "MEMBERSHIP_PENDING") {
        navigate("/perfil", { replace: true, state: { aviso: codigo === "MEMBERSHIP_PENDING" ? "Já existe uma solicitação pendente. Confira o destino abaixo." : "Sua residência mudou. Confira seu vínculo antes de solicitar transferência." } });
        await recarregarEstado();
      } else if (codigo === "CONDOMINIUM_NOT_FOUND" || codigo === "CONDOMINIUM_INACTIVE") {
        setErro("O destino não está disponível. Selecione outro condomínio."); setDestino(null); setVersao(v => v + 1);
      } else if (codigo === "SAME_CONDOMINIUM") {
        setErro("Escolha outro destino: você já reside neste condomínio.");
      } else if (codigo === "VALIDATION_ERROR" && erro instanceof ApiError) {
        setCampos(erro.detalhes?.fieldErrors ?? {}); setErro("Confira os campos da solicitação.");
      } else setErro("Não foi possível solicitar a transferência. Confira sua conexão e tente novamente.");
    } finally { trava.current = false; if (montado.current) setEnviando(false); }
  }
  return <section className="pagina-editor"><Link to="/perfil" className="voltar-vitrine">← Meu Perfil</Link><form className="card" onSubmit={e => void enviar(e)} noValidate><h1>Solicitar transferência</h1>
    <p>Sua residência atual em <strong>{situacaoResidencial?.vinculo_ativo?.condominio.nome_residencial}</strong> continua ativa até a aprovação. Pedidos em aberto e a regra do último administrador são verificados na aprovação.</p>
    <fieldset disabled={enviando}><legend>Nova residência</legend><SeletorCondominio selecionado={destino} selecionar={setDestino} idDesabilitado={situacaoResidencial?.vinculo_ativo?.condominio.id_condominio} erro={campos.id_condominio?.[0]} versao={versao} />
      <Campo id="nova-moradia" label="Nova moradia" maxLength={80} value={moradia} onChange={e => setMoradia(e.target.value)} erro={campos.moradia?.[0]} placeholder="Bloco B - Apto 302" />
      {erro && <Aviso erro>{erro}</Aviso>}<button className="botao-principal largura" disabled={!destino || enviando}>{enviando ? "Enviando solicitação…" : "Enviar solicitação de transferência"}</button>
    </fieldset></form></section>;
}
