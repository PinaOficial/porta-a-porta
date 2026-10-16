import type { MeuUsuario } from "../features/perfil/perfil.types";
import type { SituacaoResidencial } from "../features/vinculos/vinculo.types";
export type EstadoAplicacao = "SEM_SESSAO" | "CARREGANDO" | "PRECISA_ONBOARDING" | "AGUARDANDO_APROVACAO" | "USUARIO_ATIVO" | "VINCULO_INDISPONIVEL" | "SUPER_ADMIN" | "CONTA_SUSPENSA" | "ERRO";
export function resolverEstadoAplicacao(entrada: {
  temSessao: boolean; carregandoSessao: boolean; carregandoEstado: boolean;
  erroSessao?: boolean; erroEstado: { status?: number; codigo?: string } | null;
  meuUsuario: MeuUsuario | null; situacaoResidencial: SituacaoResidencial | null;
}): EstadoAplicacao {
  const { meuUsuario: usuario, situacaoResidencial: residencial, erroEstado: erro } = entrada;
  if (entrada.carregandoSessao) return "CARREGANDO";
  if (entrada.erroSessao) return "ERRO";
  if (!entrada.temSessao) return "SEM_SESSAO";
  if (erro?.status === 403 && erro.codigo === "ACCOUNT_SUSPENDED") return "CONTA_SUSPENSA";
  if (entrada.carregandoEstado) return "CARREGANDO";
  if (erro || !usuario || !residencial) return "ERRO";
  if (usuario.super_admin !== residencial.super_admin || usuario.onboarding_realizado !== residencial.onboarding_realizado) return "ERRO";
  const { vinculo_ativo: ativo, solicitacao_pendente: pendente, ultimo_vinculo: ultimo } = residencial;
  if (ativo && ativo.status_vinculo !== "ATIVO" || pendente && pendente.status_vinculo !== "PENDENTE" || ultimo && (ativo || pendente)) return "ERRO";
  if (usuario.super_admin) return ativo || pendente || ultimo ? "ERRO" : "SUPER_ADMIN";
  if (!usuario.onboarding_realizado) return ativo || pendente || ultimo ? "ERRO" : "PRECISA_ONBOARDING";
  if (residencial.vinculo_ativo?.status_vinculo === "ATIVO") return "USUARIO_ATIVO";
  if (residencial.solicitacao_pendente?.status_vinculo === "PENDENTE") return "AGUARDANDO_APROVACAO";
  if (residencial.ultimo_vinculo && ["REJEITADO", "SUSPENSO", "ENCERRADO"].includes(residencial.ultimo_vinculo.status_vinculo)) return "VINCULO_INDISPONIVEL";
  return "ERRO";
}
export const destinos: Partial<Record<EstadoAplicacao, string>> = {
  SEM_SESSAO: "/login", PRECISA_ONBOARDING: "/onboarding", AGUARDANDO_APROVACAO: "/aguardando-aprovacao",
  USUARIO_ATIVO: "/vitrine", VINCULO_INDISPONIVEL: "/estado-vinculo", SUPER_ADMIN: "/admin",
};
export const podeAcessarHistorico = (usuario: Pick<MeuUsuario, "onboarding_realizado" | "super_admin"> | null) =>
  Boolean(usuario?.onboarding_realizado && !usuario.super_admin);
