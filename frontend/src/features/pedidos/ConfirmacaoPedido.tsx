import { Link } from "react-router-dom";
import { useEffect, useRef } from "react";
import type { PedidoCriado } from "./pedido.types";
import { formatarReais } from "../../lib/moeda";
export function ConfirmacaoPedido({ pedido, voltar }: { pedido: PedidoCriado; voltar: string }) {
  const titulo = useRef<HTMLHeadingElement>(null);
  useEffect(() => { titulo.current?.focus(); }, [pedido.id_pedido]);
  return <section className="card confirmacao-pedido" aria-labelledby="titulo-confirmacao">
    <span className="etiqueta">SOLICITADO · aguardando vendedor</span>
    <h1 id="titulo-confirmacao" tabIndex={-1} ref={titulo}>Pedido enviado ao vendedor</h1>
    <p>O chat já foi criado e está disponível em Meus Pedidos.</p>
    <dl className="detalhes"><dt>Número do pedido</dt><dd>{pedido.id_pedido}</dd><dt>Produto</dt><dd>{pedido.produto.nome_produto}</dd><dt>Quantidade</dt><dd>{pedido.quantidade}</dd><dt>Total confirmado</dt><dd>{formatarReais(pedido.valor_pedido)}</dd><dt>Horário combinado</dt><dd>{new Date(pedido.hora_combinada).toLocaleString("pt-BR", { dateStyle: "long", timeStyle: "short" })}</dd></dl>
    <p>Seu pedido aguarda a resposta do vendedor.</p><div className="acoes-produto"><Link className="botao-principal" to="/pedidos">Ver meus pedidos</Link><Link className="botao-secundario" to={voltar}>Voltar à vitrine</Link></div>
  </section>;
}
