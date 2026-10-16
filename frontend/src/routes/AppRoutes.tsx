import { useEffect, type ReactNode } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useAuth } from "../features/auth/AuthProvider";
import { useEstadoUsuario } from "../features/perfil/EstadoUsuarioProvider";
import { destinos, podeAcessarHistorico, resolverEstadoAplicacao, type EstadoAplicacao } from "./estadoAplicacao";
import { Pagina, Carregamento, Sair } from "../layouts/Pagina";
import { LoginPage, ConfirmarEmailPage } from "../features/auth/LoginPage";
import { OnboardingPage } from "../features/onboarding/OnboardingPage";
import { EstadoVinculoPage } from "../features/vinculos/EstadoVinculoPage";
import { ShellPage } from "../layouts/ShellPage";
import { VitrinePage } from "../features/produtos/VitrinePage";
import { ProdutoPage } from "../features/produtos/ProdutoPage";
import { MeusProdutosPage } from "../features/produtos/MeusProdutosPage";
import { FormularioProdutoPage } from "../features/produtos/FormularioProdutoPage";
import { MeusPedidosPage } from "../features/pedidos/MeusPedidosPage";
import { ChatPedidoPage } from "../features/chat/ChatPedidoPage";
import { PerfilPage } from "../features/perfil/PerfilPage";
import { TransferenciaPage } from "../features/vinculos/TransferenciaPage";
import { AdminPage } from "../features/administracao/AdminPage";
import { VinculosAdminPage } from "../features/administracao/VinculosAdminPage";
import { podeAdministrar } from "../features/administracao/administracao.regras";

function useEstadoAplicacao() {
  const auth = useAuth();
  const dominio = useEstadoUsuario();
  return resolverEstadoAplicacao({ ...dominio, temSessao: Boolean(auth.sessao), carregandoSessao: auth.carregandoSessao, erroSessao: auth.erroSessao });
}
function Bloqueio({ suspensa }: { suspensa: boolean }) {
  const { sessao, refresh } = useAuth();
  const { erroEstado, recarregarEstado } = useEstadoUsuario();
  return <Pagina><section className="card" role="alert"><p className="sobretitulo">{suspensa ? "ACESSO BLOQUEADO" : "NÃO FOI POSSÍVEL CONTINUAR"}</p><h1>{suspensa ? "Conta suspensa" : "Vamos tentar de novo?"}</h1>
    <p>{suspensa ? "O acesso desta conta foi suspenso. Procure a administração para orientações." : erroEstado?.codigo === "UNAUTHENTICATED" ? "Sua sessão não foi aceita. Saia e entre novamente para continuar." : "Não conseguimos confirmar seu acesso. Verifique sua conexão e atualize o estado da conta."}</p>
    {!suspensa && <button className="botao-principal largura" onClick={() => void (sessao ? recarregarEstado() : refresh())}>Tentar novamente</button>}
    <Sair />
  </section></Pagina>;
}
export function Guard({ permitido, children }: { permitido: EstadoAplicacao; children: ReactNode }) {
  const estado = useEstadoAplicacao();
  if (estado === "CARREGANDO") return <Carregamento />;
  if (estado === "CONTA_SUSPENSA" || estado === "ERRO") return <Bloqueio suspensa={estado === "CONTA_SUSPENSA"} />;
  return estado === permitido ? children : <Navigate to={destinos[estado] ?? "/"} replace />;
}
function GuardHistorico({ children, observador = false }: { children: ReactNode; observador?: boolean }) {
  const estado = useEstadoAplicacao();
  const auth = useAuth();
  const dominio = useEstadoUsuario();
  if (estado === "CARREGANDO") return <Carregamento />;
  if (estado === "CONTA_SUSPENSA") return <Bloqueio suspensa />;
  if (auth.erroSessao || dominio.erroEstado || auth.sessao && !dominio.meuUsuario) return <Bloqueio suspensa={false} />;
  // Histórico exige identidade/perfil, mesmo se não houver residência para resolver o catálogo.
  if (auth.sessao && (podeAcessarHistorico(dominio.meuUsuario) || observador && dominio.meuUsuario?.super_admin)) return children;
  return <Navigate to={destinos[estado] ?? "/onboarding"} replace />;
}
function Inicio() {
  const estado = useEstadoAplicacao();
  if (estado === "CARREGANDO") return <Carregamento />;
  if (estado === "CONTA_SUSPENSA" || estado === "ERRO") return <Bloqueio suspensa={estado === "CONTA_SUSPENSA"} />;
  return <Navigate to={destinos[estado] ?? "/login"} replace />;
}
function GuardAdmin({ children }: { children: ReactNode }) {
  const estado = useEstadoAplicacao();
  const { meuUsuario, situacaoResidencial } = useEstadoUsuario();
  if (estado === "CARREGANDO") return <Carregamento />;
  if (estado === "CONTA_SUSPENSA" || estado === "ERRO") return <Bloqueio suspensa={estado === "CONTA_SUSPENSA"} />;
  if (!podeAdministrar(meuUsuario, situacaoResidencial)) return <Navigate to={destinos[estado] ?? "/login"} replace />;
  // Uma mudança de identidade, papel ou residência descarta listas e resultados do escopo anterior.
  return <ShellPage key={`${meuUsuario?.id_usuario}-${meuUsuario?.super_admin}-${situacaoResidencial?.vinculo_ativo?.id_vinculo}`} administracao>{children}</ShellPage>;
}
function FocoPagina() {
  const { pathname } = useLocation();
  useEffect(() => {
    document.title = "Porta a Porta";
    document.getElementById("conteudo")?.focus();
  }, [pathname]);
  return null;
}
export function AppRoutes() {
  return <><FocoPagina /><Routes>
    <Route path="/" element={<Inicio />} />
    <Route path="/login" element={<Guard permitido="SEM_SESSAO"><LoginPage key="login" /></Guard>} />
    <Route path="/cadastro" element={<Guard permitido="SEM_SESSAO"><LoginPage key="cadastro" cadastro /></Guard>} />
    <Route path="/confirmar-email" element={<Guard permitido="SEM_SESSAO"><ConfirmarEmailPage /></Guard>} />
    <Route path="/onboarding" element={<Guard permitido="PRECISA_ONBOARDING"><OnboardingPage /></Guard>} />
    <Route path="/aguardando-aprovacao" element={<Guard permitido="AGUARDANDO_APROVACAO"><EstadoVinculoPage pendente /></Guard>} />
    <Route path="/estado-vinculo" element={<Guard permitido="VINCULO_INDISPONIVEL"><EstadoVinculoPage /></Guard>} />
    <Route path="/vitrine" element={<Guard permitido="USUARIO_ATIVO"><ShellPage><VitrinePage /></ShellPage></Guard>} />
    <Route path="/produtos/:id" element={<Guard permitido="USUARIO_ATIVO"><ShellPage><ProdutoPage /></ShellPage></Guard>} />
    <Route path="/meus-produtos" element={<Guard permitido="USUARIO_ATIVO"><ShellPage><MeusProdutosPage /></ShellPage></Guard>} />
    <Route path="/meus-produtos/novo" element={<Guard permitido="USUARIO_ATIVO"><ShellPage><FormularioProdutoPage novo /></ShellPage></Guard>} />
    <Route path="/meus-produtos/:id/editar" element={<Guard permitido="USUARIO_ATIVO"><ShellPage><FormularioProdutoPage /></ShellPage></Guard>} />
    <Route path="/pedidos" element={<GuardHistorico><ShellPage historico><MeusPedidosPage /></ShellPage></GuardHistorico>} />
    <Route path="/pedidos/:id/chat" element={<GuardHistorico observador><ShellPage historico><ChatPedidoPage /></ShellPage></GuardHistorico>} />
    <Route path="/perfil" element={<GuardHistorico observador><ShellPage historico><PerfilPage /></ShellPage></GuardHistorico>} />
    <Route path="/perfil/transferencia" element={<Guard permitido="USUARIO_ATIVO"><ShellPage><TransferenciaPage /></ShellPage></Guard>} />
    <Route path="/admin" element={<GuardAdmin><AdminPage /></GuardAdmin>} />
    <Route path="/admin/vinculos" element={<GuardAdmin><VinculosAdminPage key="geral" /></GuardAdmin>} />
    <Route path="/admin/vinculos/pendentes" element={<GuardAdmin><VinculosAdminPage key="pendentes" pendentes /></GuardAdmin>} />
    <Route path="*" element={<Inicio />} />
  </Routes></>;
}
