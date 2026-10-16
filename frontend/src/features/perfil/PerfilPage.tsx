import { Link, useLocation } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import { useEstadoUsuario } from "./EstadoUsuarioProvider";
import { Aviso } from "../../components/ui/Campo";
import { formatarDataHora } from "../../lib/data";
import type { Vinculo } from "../vinculos/vinculo.types";

function Residencia({ titulo, vinculo }: { titulo: string; vinculo: Vinculo }) {
  return <article className="card residencia"><h2>{titulo}</h2><span className="etiqueta">{vinculo.status_vinculo}</span>
    <dl className="detalhes"><dt>Condomínio</dt><dd>{vinculo.condominio.nome_residencial}</dd><dt>Moradia</dt><dd>{vinculo.moradia}</dd>
      <dt>Administração do vínculo</dt><dd>{vinculo.admin_condominio ? "Administrador" : "Morador"}</dd>
      {([['Solicitação', vinculo.data_solicitacao], ['Aprovação', vinculo.data_aprovacao], ['Início', vinculo.data_inicio], ['Fim', vinculo.data_fim]] as const).map(([nome, data]) => data && <div key={nome}><dt>{nome}</dt><dd><time dateTime={data}>{formatarDataHora(data)}</time></dd></div>)}
    </dl></article>;
}
export function PerfilPage() {
  const { usuario } = useAuth();
  const { meuUsuario, situacaoResidencial: residencia, recarregarEstado } = useEstadoUsuario();
  const { state } = useLocation();
  return <section className="perfil"><div className="titulo-vitrine linha"><h1>Meu Perfil</h1><button className="botao-secundario" onClick={() => void recarregarEstado()}>Atualizar perfil</button></div>
    {typeof state?.aviso === "string" && <Aviso>{state.aviso}</Aviso>}
    <article className="card"><h2>Minha identidade</h2><dl className="detalhes"><dt>Nome completo</dt><dd>{meuUsuario?.nome_completo ?? "Não informado"}</dd><dt>E-mail da sessão</dt><dd>{usuario?.email ?? "Não informado"}</dd><dt>Identificação da conta</dt><dd>{meuUsuario?.id_usuario}</dd><dt>Cadastro no domínio</dt><dd>{meuUsuario?.onboarding_realizado ? "Realizado" : "Ainda não realizado"}</dd></dl></article>
    {meuUsuario?.super_admin ? <article className="card"><h2>Identidade global</h2><p>Você acessa a administração como Super admin, sem residência associada.</p><Link to="/admin">Abrir administração</Link></article> : <>
      {residencia?.vinculo_ativo && <Residencia titulo="Residência atual" vinculo={residencia.vinculo_ativo} />}
      {residencia?.solicitacao_pendente && <><Residencia titulo={residencia.vinculo_ativo ? "Destino da transferência — aguardando aprovação" : "Residência — aguardando aprovação"} vinculo={residencia.solicitacao_pendente} /><Aviso>{residencia.vinculo_ativo ? "Sua residência atual continua ativa enquanto a transferência aguarda aprovação." : "Sua solicitação aguarda a decisão da administração."} Já existe uma solicitação pendente; não é possível enviar outra.</Aviso></>}
      {!residencia?.vinculo_ativo && !residencia?.solicitacao_pendente && (residencia?.ultimo_vinculo ? <><Residencia titulo="Último vínculo registrado" vinculo={residencia.ultimo_vinculo} /><p>Este é o último vínculo retornado, não um histórico completo. Para orientações sobre sua residência, procure a administração.</p></> : <Aviso>Nenhuma residência atual ou solicitação pendente disponível.</Aviso>)}
      {residencia?.vinculo_ativo && !residencia.solicitacao_pendente && <article className="card"><h2>Mudar de condomínio</h2><p>Solicitar transferência mantém sua residência atual ativa. A aprovação depende de pedidos em aberto e, para administradores, da regra do último admin.</p><Link className="botao-principal" to="/perfil/transferencia">Solicitar transferência</Link></article>}
      <p><Link to="/pedidos">Meus pedidos anteriores</Link> e suas conversas continuam disponíveis, inclusive sem vínculo ativo.</p>
    </>}
  </section>;
}
