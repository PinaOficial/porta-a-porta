import { useRef, useState } from "react";
import { ApiError } from "../../lib/api";
import { Aviso, Campo } from "../../components/ui/Campo";
import { alterarStatusPedido } from "./pedido.api";
import { alterarStatusPedidoSchema } from "./pedido.schema";
import { acoesPermitidasPedido, nomesAcaoPedido, nomesStatusPedido } from "./pedido.regras";
import type { DestinoPedido, MeuPedido } from "./pedido.types";

export function AcaoPedido({ pedido, bloqueado, atualizar, informar, indisponivel }: {
  pedido: MeuPedido; bloqueado: boolean; atualizar: () => Promise<void>;
  informar: (mensagem: string, erro?: boolean) => void; indisponivel: () => void;
}) {
  const [motivo, setMotivo] = useState("");
  const [erro, setErro] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [semPermissao, setSemPermissao] = useState(false);
  const trava = useRef(false);
  const acoes = acoesPermitidasPedido(pedido.papel_usuario, pedido.status_pedido);
  async function executar(status: DestinoPedido) {
    if (trava.current || bloqueado || semPermissao || !acoes.includes(status)) return;
    const validacao = alterarStatusPedidoSchema.safeParse({ status, motivo });
    if (!validacao.success) { setErro(validacao.error.issues[0]?.message ?? "Confira o motivo."); return; }
    if (status !== "ACEITO" && !window.confirm(`${nomesAcaoPedido[status]} o pedido de ${pedido.produto.nome_produto}? Esta decisão encerra o pedido.`)) return;
    trava.current = true; setEnviando(true); setErro("");
    try {
      const resposta = await alterarStatusPedido(pedido.id_pedido, validacao.data);
      informar(`Pedido atualizado para ${nomesStatusPedido[resposta.dados.status_pedido]}. A lista foi atualizada com os filtros atuais.`);
      setMotivo("");
      await atualizar();
    } catch (erro) {
      if (erro instanceof ApiError) {
        if (erro.codigo === "INVALID_ORDER_TRANSITION") { informar("O pedido mudou antes desta ação. Confira o status e o histórico atualizados antes de decidir novamente.", true); await atualizar(); }
        else if (erro.codigo === "ORDER_STATUS_FORBIDDEN") { setSemPermissao(true); informar("Você não tem permissão para esta ação. Os dados do pedido foram atualizados.", true); await atualizar(); }
        else if (erro.codigo === "ORDER_NOT_FOUND") { indisponivel(); informar("Pedido indisponível para sua conta.", true); await atualizar(); }
        else if (erro.codigo === "VALIDATION_ERROR") setErro(erro.detalhes?.fieldErrors?.motivo?.join(" ") || erro.detalhes?.fieldErrors?.status?.join(" ") || "Confira os dados da ação.");
        else setErro("Não foi possível confirmar a alteração. Atualize os pedidos antes de tentar novamente.");
      } else setErro("Não foi possível confirmar a alteração. Atualize os pedidos antes de tentar novamente.");
    } finally { trava.current = false; setEnviando(false); }
  }
  if (!acoes.length || semPermissao) return erro ? <Aviso erro>{erro}</Aviso> : null;
  return <div className="acoes-pedido" aria-busy={enviando}><fieldset disabled={enviando || bloqueado}>
    <Campo id={`motivo-${pedido.id_pedido}`} label="Motivo (opcional)" maxLength={255} value={motivo} erro={erro} onChange={e => setMotivo(e.target.value)} />
    <div className="acoes-produto">{acoes.map(status => <button type="button" className={status === "ACEITO" ? "botao-principal" : "botao-secundario"} key={status} onClick={() => void executar(status)}>{enviando ? "Atualizando pedido…" : nomesAcaoPedido[status]}</button>)}</div>
  </fieldset></div>;
}
