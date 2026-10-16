import { Pagina, Sair } from "../../layouts/Pagina";
import { useEstadoUsuario } from "../perfil/EstadoUsuarioProvider";
import { Link } from "react-router-dom";
const statusTexto = { REJEITADO: "Solicitação rejeitada", SUSPENSO: "Vínculo suspenso", ENCERRADO: "Vínculo encerrado", ATIVO: "Vínculo ativo", PENDENTE: "Aguardando aprovação" };
export function EstadoVinculoPage({ pendente = false }: { pendente?: boolean }) {
  const { meuUsuario, situacaoResidencial, recarregarEstado, carregandoEstado } = useEstadoUsuario();
  const vinculo = pendente ? situacaoResidencial?.solicitacao_pendente : situacaoResidencial?.ultimo_vinculo;
  return <Pagina><section className="card"><p className="sobretitulo">SUA RESIDÊNCIA</p>
    <span className="etiqueta">{pendente ? "Aguardando aprovação" : vinculo ? statusTexto[vinculo.status_vinculo] : "Vínculo indisponível"}</span>
    <h1>{pendente ? "Sua solicitação está a caminho" : "Seu acesso residencial está indisponível"}</h1>
    <p>{pendente ? "A administração do condomínio precisa aprovar sua solicitação. Você pode conferir o status por aqui." : "Confira o estado do seu vínculo abaixo. Para orientações, procure a administração do condomínio."}</p>
    {vinculo && <dl className="detalhes"><dt>Condomínio</dt><dd>{vinculo.condominio.nome_residencial}</dd><dt>Moradia</dt><dd>{vinculo.moradia}</dd>
      {pendente && <><dt>Solicitação enviada em</dt><dd>{new Date(vinculo.data_solicitacao).toLocaleString("pt-BR", { dateStyle: "long", timeStyle: "short" })}</dd></>}
    </dl>}
    <button className="botao-principal largura" disabled={carregandoEstado} onClick={() => void recarregarEstado()}>Atualizar status</button>{meuUsuario?.onboarding_realizado && !meuUsuario.super_admin && <><Link className="botao-secundario largura" to="/perfil">Meu Perfil</Link><Link className="botao-secundario largura" to="/pedidos">Meus pedidos anteriores</Link></>}<Sair />
  </section></Pagina>;
}
