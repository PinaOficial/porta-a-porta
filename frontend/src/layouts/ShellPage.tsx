import type { ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { Pagina, Sair } from "./Pagina";
import { useEstadoUsuario } from "../features/perfil/EstadoUsuarioProvider";
import { useAuth } from "../features/auth/AuthProvider";
import { Aviso } from "../components/ui/Campo";
import { podeAdministrar } from "../features/administracao/administracao.regras";
export function ShellPage({ administracao = false, historico = false, children }: { administracao?: boolean; historico?: boolean; children?: ReactNode }) {
  const { meuUsuario, situacaoResidencial } = useEstadoUsuario();
  const { usuario } = useAuth();
  const ativo = situacaoResidencial?.vinculo_ativo;
  const pendente = situacaoResidencial?.solicitacao_pendente;
  const observador = historico && meuUsuario?.super_admin === true;
  const superAdmin = meuUsuario?.super_admin === true;
  const { pathname } = useLocation();
  return <Pagina ampla><div className="mercado"><section className="card cabecalho-morador">
    <div className="linha"><div><p className="sobretitulo">{superAdmin ? "ADMINISTRAÇÃO GLOBAL" : administracao ? "ADMIN DO CONDOMÍNIO" : "SUA VIZINHANÇA"}</p><p className="saudacao">Olá{meuUsuario?.nome_completo ? `, ${meuUsuario.nome_completo}` : ""}!</p></div><Sair /></div>
    {superAdmin ? <><span className="etiqueta">Super admin</span><p>{usuario?.email}</p></> : <>
      {ativo && <dl className="detalhes"><dt>Condomínio atual</dt><dd>{ativo.condominio.nome_residencial}</dd><dt>Moradia</dt><dd>{ativo.moradia}</dd></dl>}
      {historico && !ativo && <Aviso>{observador ? "Super admin · leitura de conversa por ID." : "Seus pedidos anteriores continuam disponíveis. Vitrine e publicação exigem vínculo ativo."}</Aviso>}
      {ativo?.admin_condominio && <p className="etiqueta">Administrador do condomínio</p>}
      {ativo && pendente && <Aviso>Mudança de condomínio aguardando aprovação: <strong>{pendente.condominio.nome_residencial}</strong>. Você continua com acesso ao condomínio atual.</Aviso>}
    </>}
    <nav className="navegacao" aria-label="Navegação principal">{ativo && <><Link to="/vitrine" aria-current={pathname === "/vitrine" ? "page" : undefined}>Vitrine</Link><Link to="/meus-produtos" aria-current={pathname.startsWith("/meus-produtos") ? "page" : undefined}>Meus Produtos</Link></>}{!superAdmin && <Link to="/pedidos" aria-current={pathname.startsWith("/pedidos") ? "page" : undefined}>Pedidos</Link>}{historico && !ativo && !observador && <Link to={pendente ? "/aguardando-aprovacao" : "/estado-vinculo"}>Estado do vínculo</Link>}<Link to="/perfil" aria-current={pathname.startsWith("/perfil") ? "page" : undefined}>Perfil</Link>{podeAdministrar(meuUsuario, situacaoResidencial) && <Link to="/admin" aria-current={pathname.startsWith("/admin") ? "page" : undefined}>Administração</Link>}</nav>
  </section>{children}</div></Pagina>;
}
