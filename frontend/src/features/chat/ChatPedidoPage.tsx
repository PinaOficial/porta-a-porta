import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useLocation, useParams, useSearchParams } from "react-router-dom";
import { z } from "zod";
import { ApiError } from "../../lib/api";
import { Aviso } from "../../components/ui/Campo";
import { formatarDataHora } from "../../lib/data";
import { useAuth } from "../auth/AuthProvider";
import { useEstadoUsuario } from "../perfil/EstadoUsuarioProvider";
import { nomesStatusPedido } from "../pedidos/pedido.regras";
import type { PapelPedido } from "../pedidos/pedido.types";
import { consultarChatPedido, enviarMensagemPedido } from "./chat.api";
import { contextoChatSchema, mensagemChatSchema, paginaChatSchema } from "./chat.schema";
import type { ChatPedido } from "./chat.types";

export function ChatPedidoPage() {
  const { id = "" } = useParams();
  return <ConversaPedido key={id} id={id} />;
}
function ConversaPedido({ id }: { id: string }) {
  const [query, setQuery] = useSearchParams();
  const paginas = query.getAll("pagina");
  const validacao = paginaChatSchema.safeParse(paginas.length > 1 ? paginas : paginas[0]);
  const pagina = validacao.success ? validacao.data : 1;
  const valida = validacao.success;
  const idValido = z.uuid().safeParse(id).success;
  const { state } = useLocation();
  const { usuario } = useAuth();
  const { meuUsuario } = useEstadoUsuario();
  const observador = meuUsuario?.super_admin === true;
  const dica = contextoChatSchema.safeParse(state);
  const papelDica = !observador && dica.success && dica.data.id_usuario === usuario?.id && dica.data.id_pedido === id ? dica.data.papel_usuario : null;
  const [papelConfirmado, setPapelConfirmado] = useState<PapelPedido | null>(null);
  const [resposta, setResposta] = useState<ChatPedido | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erroLeitura, setErroLeitura] = useState<ApiError | null>(null);
  const [conteudo, setConteudo] = useState("");
  const [erroEnvio, setErroEnvio] = useState("");
  const [sucesso, setSucesso] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [bloqueioEnvio, setBloqueioEnvio] = useState(false);
  const [idConfirmado, setIdConfirmado] = useState<string | null>(null);
  const controle = useRef<AbortController | null>(null);
  const montado = useRef(false);
  const travaEnvio = useRef(false);
  const carregarAtual = useRef<(ultimas?: boolean) => Promise<void>>(async () => {});
  const carregar = useCallback(async (ultimas = false) => {
    controle.current?.abort();
    if (!montado.current || !valida) return;
    const abort = new AbortController(); controle.current = abort;
    setCarregando(true); setErroLeitura(null);
    try {
      if (!idValido) throw new ApiError(404, "ORDER_NOT_FOUND", "Pedido indisponível.");
      const dados = await consultarChatPedido(id, pagina, abort.signal);
      if (abort.signal.aborted) return;
      const ultima = Math.max(1, dados.paginacao.total_paginas);
      if (pagina > ultima || ultimas && pagina !== ultima) { setQuery({ pagina: String(ultima) }, { replace: true }); return; }
      setResposta(dados);
    } catch (erro) {
      if (!abort.signal.aborted) {
        const falha = erro instanceof ApiError ? erro : new ApiError(0, "NETWORK_ERROR", "Não foi possível carregar a conversa.");
        setErroLeitura(falha);
        if (["ORDER_NOT_FOUND", "CHAT_NOT_FOUND"].includes(falha.codigo)) setResposta(null);
      }
    } finally { if (!abort.signal.aborted) setCarregando(false); }
  }, [id, pagina, valida, idValido, setQuery]);
  carregarAtual.current = carregar;
  useEffect(() => { montado.current = true; void carregar(); return () => { montado.current = false; controle.current?.abort(); }; }, [carregar]);
  async function enviar(event: FormEvent) {
    event.preventDefault();
    if (travaEnvio.current || observador || bloqueioEnvio || carregando || erroLeitura || resposta?.conversa.status_conversa !== "ATIVA") return;
    const validacao = mensagemChatSchema.safeParse({ conteudo });
    if (!validacao.success) { setErroEnvio(validacao.error.issues[0]?.message ?? "Confira a mensagem."); return; }
    travaEnvio.current = true; setEnviando(true); setErroEnvio(""); setSucesso("");
    try {
      const criada = await enviarMensagemPedido(id, validacao.data.conteudo);
      if (!montado.current) return;
      setIdConfirmado(criada.dados.id_mensagem);
      setPapelConfirmado(criada.dados.remetente.papel);
      setConteudo(""); setSucesso("Mensagem enviada.");
      await carregarAtual.current(true);
    } catch (erro) {
      if (!montado.current) return;
      if (erro instanceof ApiError) {
        if (erro.codigo === "CHAT_CLOSED") { setBloqueioEnvio(true); setErroEnvio("A conversa foi encerrada. As mensagens anteriores continuam disponíveis."); await carregarAtual.current(); }
        else if (erro.codigo === "CHAT_SEND_FORBIDDEN") { setBloqueioEnvio(true); setErroEnvio("Você não possui permissão para enviar nesta conversa."); await carregarAtual.current(); }
        else if (["ORDER_NOT_FOUND", "CHAT_NOT_FOUND"].includes(erro.codigo)) { setErroLeitura(erro); setResposta(null); }
        else if (erro.codigo === "VALIDATION_ERROR") setErroEnvio(erro.detalhes?.fieldErrors?.conteudo?.join(" ") || "Confira a mensagem antes de enviar.");
        else setErroEnvio("Não foi possível confirmar o envio. Seu texto foi mantido; atualize a conversa antes de tentar novamente.");
      } else setErroEnvio("Não foi possível confirmar o envio. Seu texto foi mantido; atualize a conversa antes de tentar novamente.");
    } finally { travaEnvio.current = false; if (montado.current) setEnviando(false); }
  }
  if (!validacao.success) return <section className="card"><h1>Confira a página da conversa</h1><Aviso erro>Página inválida.</Aviso><button className="botao-principal" onClick={() => setQuery({})}>Voltar à primeira página</button></section>;
  const papelUsuario = papelConfirmado ?? papelDica;
  const fechada = resposta?.conversa.status_conversa === "ENCERRADA";
  const bloqueado = observador || bloqueioEnvio || fechada || Boolean(erroLeitura) || carregando || enviando || !resposta;
  return <section className="chat-pedido"><Link className="voltar-vitrine" to={observador ? "/admin" : "/pedidos"}>{observador ? "← Voltar à administração" : "← Voltar a Meus Pedidos"}</Link><div className="titulo-vitrine"><p className="sobretitulo">CONVERSA DO PEDIDO</p><h1>Pedido #{id.slice(0, 8)}</h1>{resposta && <p><span className="etiqueta">{nomesStatusPedido[resposta.pedido.status_pedido]}</span> <span className="etiqueta">Conversa {fechada ? "encerrada" : "ativa"}</span></p>}</div>
    <div className="acoes-produto"><button className="botao-secundario" disabled={carregando || enviando} onClick={() => void carregarAtual.current()}>Atualizar conversa</button><button className="botao-secundario" disabled={carregando || enviando || !resposta} onClick={() => void carregarAtual.current(true)}>Ir para as últimas mensagens</button></div><p className="ajuda">As mensagens aparecem das mais antigas para as mais recentes. Atualize para acompanhar novas mensagens.</p>
    {erroLeitura && <Aviso erro>{erroLeitura.codigo === "ORDER_NOT_FOUND" ? "Conversa indisponível para sua conta." : erroLeitura.codigo === "CHAT_NOT_FOUND" ? "Este pedido não possui uma conversa disponível." : "Não foi possível atualizar a conversa. Verifique sua conexão."} <button className="botao-texto" disabled={carregando} onClick={() => void carregarAtual.current()}>Tentar novamente</button></Aviso>}
    {carregando && <p role="status">Carregando mensagens…</p>}{sucesso && <Aviso>{sucesso}{idConfirmado && resposta?.dados.some(m => m.id_mensagem === idConfirmado) ? " A conversa está atualizada." : " Use Atualizar conversa se precisar conferir novamente."}</Aviso>}
    {resposta && <><div className="card painel-mensagens" aria-busy={carregando}>{!resposta.dados.length && <p role="status">Ainda não há mensagens nesta conversa.</p>}<ol className="mensagens" aria-label="Mensagens da conversa">{resposta.dados.map(mensagem => <li key={mensagem.id_mensagem} data-mensagem-id={mensagem.id_mensagem} className={papelUsuario && mensagem.remetente.papel === papelUsuario ? "mensagem propria" : "mensagem"}><p className="remetente"><strong>{mensagem.remetente.nome_completo}</strong> · {mensagem.remetente.papel === "COMPRADOR" ? "Comprador" : mensagem.remetente.papel === "VENDEDOR" ? "Vendedor" : "Participante"}</p><p className="conteudo-mensagem">{mensagem.conteudo}</p><time dateTime={mensagem.created_at}>{formatarDataHora(mensagem.created_at)}</time></li>)}</ol></div>
      {resposta.paginacao.total_paginas > 0 && <nav className="paginacao paginacao-produtos" aria-label="Paginação da conversa"><button className="botao-secundario" disabled={carregando || enviando || pagina <= 1} onClick={() => setQuery({ pagina: String(pagina - 1) })}>Anterior</button><span>Página {resposta.paginacao.pagina} de {resposta.paginacao.total_paginas}</span><button className="botao-secundario" disabled={carregando || enviando || pagina >= resposta.paginacao.total_paginas} onClick={() => setQuery({ pagina: String(pagina + 1) })}>Próxima</button></nav>}
      <form className="card compositor-chat" onSubmit={enviar} aria-busy={enviando}><div className="campo"><label htmlFor="conteudo-chat">Mensagem</label><textarea id="conteudo-chat" rows={4} maxLength={1000} disabled={bloqueado} value={conteudo} aria-invalid={Boolean(erroEnvio)} aria-describedby={erroEnvio ? "erro-envio-chat" : "limite-mensagem"} onChange={e => setConteudo(e.target.value)} /><span className="ajuda" id="limite-mensagem">{conteudo.length}/1000 caracteres</span></div><button className="botao-principal" type="submit" disabled={bloqueado || !conteudo.trim()}>{enviando ? "Enviando…" : "Enviar"}</button>{fechada && <p>Conversa encerrada. Você pode continuar lendo o histórico.</p>}{observador && <p>Leitura de super admin. O envio como observador está desabilitado.</p>}</form>
    </>}{erroEnvio && <div id="erro-envio-chat"><Aviso erro>{erroEnvio}</Aviso></div>}
  </section>;
}
