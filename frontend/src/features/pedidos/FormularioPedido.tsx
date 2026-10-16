import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { Campo, Aviso } from "../../components/ui/Campo";
import { ApiError } from "../../lib/api";
import { formatarReais, calcularTotalEstimado } from "../../lib/moeda";
import type { ProdutoDetalhe } from "../produtos/produto.types";
import { useEstadoUsuario } from "../perfil/EstadoUsuarioProvider";
import { criarPedido } from "./pedido.api";
import { converterHorarioLocal, formularioPedidoSchema, horarioLocalAtual } from "./pedido.schema";
import type { PedidoCriado } from "./pedido.types";

export function FormularioPedido({ produto, bloqueado, atualizarProduto, aoCriar }: {
  produto: ProdutoDetalhe; bloqueado: boolean;
  atualizarProduto: () => Promise<void>; aoCriar: (pedido: PedidoCriado) => void;
}) {
  const [quantidade, setQuantidade] = useState("1");
  const [horario, setHorario] = useState("");
  const [erros, setErros] = useState<Record<string, string>>({});
  const [erro, setErro] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [envioIncerto, setEnvioIncerto] = useState(false);
  const emVoo = useRef(false);
  const montado = useRef(false);
  useEffect(() => { montado.current = true; return () => { montado.current = false; }; }, []);
  const { recarregarEstado } = useEstadoUsuario();
  useEffect(() => {
    if (produto.estoque > 0) setQuantidade(atual => Number(atual) > produto.estoque ? String(produto.estoque) : atual);
  }, [produto.estoque]);
  const total = calcularTotalEstimado(produto.preco, Number(quantidade));
  const horaIso = converterHorarioLocal(horario);
  async function enviar(event: FormEvent) {
    event.preventDefault();
    if (emVoo.current || bloqueado || produto.estoque === 0) return;
    setErros({}); setErro(""); setEnvioIncerto(false);
    const validacao = formularioPedidoSchema(produto.estoque).safeParse({ quantidade, hora_combinada: horario });
    if (!validacao.success) {
      setErros(Object.fromEntries(validacao.error.issues.map(issue => [String(issue.path[0]), issue.message]))); return;
    }
    emVoo.current = true; setEnviando(true);
    try {
      const resposta = await criarPedido({ id_produto: produto.id_produto, ...validacao.data });
      if (!montado.current) return;
      aoCriar(resposta.dados);
      void atualizarProduto();
    } catch (erro) {
      if (!montado.current) return;
      if (erro instanceof ApiError) {
        switch (erro.codigo) {
          case "INSUFFICIENT_STOCK":
            setErro("O estoque mudou enquanto você escolhia. Confira a quantidade atualizada antes de confirmar novamente.");
            await atualizarProduto(); break;
          case "PRODUCT_UNAVAILABLE": case "PRODUCT_NOT_FOUND":
            setErro("Este anúncio não está mais disponível. Estamos atualizando os dados do produto.");
            await atualizarProduto(); break;
          case "CANNOT_BUY_OWN_PRODUCT":
            setErro("Você não pode pedir um produto do próprio anúncio.");
            await atualizarProduto(); break;
          case "FORBIDDEN_CROSS_TENANT": case "MEMBERSHIP_REQUIRED":
            setErro("Seu acesso residencial mudou. Estamos atualizando sua conta.");
            await recarregarEstado(); break;
          case "INVALID_SCHEDULE_TIME":
            setErros({ hora_combinada: "O horário não foi aceito. Escolha uma nova data e hora futuras." }); break;
          case "ORDER_VALUE_OUT_OF_RANGE":
            setErro("O valor deste pedido ultrapassa o limite permitido. Revise a quantidade antes de tentar novamente."); break;
          case "VALIDATION_ERROR":
            setErros(Object.fromEntries(Object.entries(erro.detalhes?.fieldErrors ?? {}).map(([campo, valores]) => [campo, valores.join(" ")])));
            setErro(erro.detalhes?.formErrors?.join(" ") || "Confira os dados do pedido."); break;
          default:
            setEnvioIncerto(true);
            setErro("Não foi possível confirmar o envio do pedido. Confira Meus Pedidos antes de tentar novamente, pois o pedido pode ter sido criado.");
        }
      } else {
        setEnvioIncerto(true);
        setErro("Não foi possível confirmar o envio do pedido. Confira Meus Pedidos antes de tentar novamente, pois o pedido pode ter sido criado.");
      }
    } finally { emVoo.current = false; if (montado.current) setEnviando(false); }
  }
  return <section className="card formulario-pedido" aria-labelledby="titulo-pedido"><h2 id="titulo-pedido">Combine seu pedido</h2><p>Escolha a quantidade e sugira quando deseja combinar a entrega com o vendedor.</p>
    <form onSubmit={enviar} noValidate aria-busy={enviando}><fieldset disabled={bloqueado || enviando || produto.estoque === 0 || !produto.ativo || !produto.categoria.ativo}>
      <Campo id="quantidade" label="Quantidade" type="number" inputMode="numeric" min={1} max={produto.estoque} step={1} required value={quantidade} erro={erros.quantidade} onChange={e => setQuantidade(e.target.value)} />
      <Campo id="hora_combinada" label="Data e hora combinada" type="datetime-local" min={horarioLocalAtual()} required value={horario} erro={erros.hora_combinada} aria-describedby="orientacao-horario" onChange={e => setHorario(e.target.value)} />
      <p id="orientacao-horario" className="ajuda">Informe a data e a hora no seu fuso local.</p>
      <dl className="detalhes resumo-pedido"><dt>Produto</dt><dd>{produto.nome_produto}</dd><dt>Quantidade</dt><dd>{quantidade || "—"}</dd><dt>Preço unitário atual</dt><dd>{formatarReais(produto.preco)}</dd><dt>Total estimado</dt><dd>{total ? formatarReais(total) : "—"}</dd><dt>Horário escolhido</dt><dd>{horaIso ? new Date(horaIso).toLocaleString("pt-BR", { dateStyle: "long", timeStyle: "short" }) : "Escolha a data e hora acima"}</dd></dl>
      <p className="ajuda">O estoque e o valor final serão confirmados ao enviar.</p>
      <button className="botao-principal largura" type="submit">{enviando ? "Enviando pedido…" : "Confirmar pedido"}</button>
    </fieldset>{erro && <Aviso erro>{erro}{envioIncerto && <> <Link to="/pedidos">Conferir Meus Pedidos</Link></>}</Aviso>}</form>
    {produto.estoque === 0 && <Aviso>Sem estoque no momento</Aviso>}
  </section>;
}
