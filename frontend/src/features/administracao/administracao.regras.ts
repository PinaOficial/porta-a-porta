import type { MeuUsuario } from "../perfil/perfil.types";
import type { SituacaoResidencial } from "../vinculos/vinculo.types";
import type { ItemAdministrativo } from "./administracao.types";
import { ApiError } from "../../lib/api.client";
export function podeAdministrar(usuario: MeuUsuario | null, residencia: SituacaoResidencial | null) {
  return Boolean(usuario?.super_admin || usuario?.onboarding_realizado && residencia?.vinculo_ativo?.status_vinculo === "ATIVO" && residencia.vinculo_ativo.admin_condominio);
}
export function podeAlterarAdmin(item: ItemAdministrativo, superAdmin: boolean, idVinculoAtual?: string) {
  return "admin_condominio" in item && item.status_vinculo === "ATIVO" && (superAdmin || item.id_vinculo !== idVinculoAtual);
}
export function mensagemErroAdmin(erro: unknown): string {
  const mensagens: Record<string, string> = {
    FORBIDDEN: "Sua conta não tem autoridade para esta ação. Atualizamos suas permissões.",
    FORBIDDEN_CROSS_TENANT: "Este condomínio não pertence ao seu escopo de administração. Atualizamos suas permissões.",
    MEMBERSHIP_NOT_FOUND: "O vínculo não está disponível. A lista foi atualizada.",
    MEMBERSHIP_NOT_PENDING: "A solicitação já foi decidida por outra pessoa. Confira a lista atualizada.",
    MEMBERSHIP_NOT_ACTIVE: "O vínculo deixou de estar ativo. Confira a lista atualizada.",
    MEMBERSHIP_INCONSISTENT: "O estado residencial mudou. Confira a lista atualizada antes de agir.",
    OPEN_ORDERS_BLOCK_TRANSFER: "A transferência não pode ser aprovada enquanto houver pedidos abertos. A solicitação continua pendente.",
    LAST_ACTIVE_ADMIN: "A transferência deixaria o condomínio sem administrador ativo. Defina um substituto ou procure um super admin. A solicitação continua pendente.",
    ACTIVE_MEMBERSHIP_ALREADY_EXISTS: "Houve um conflito entre vínculos ativos. Confira a lista atualizada; a ação não foi repetida.",
    SELF_ADMIN_CHANGE_FORBIDDEN: "Você não pode alterar seu próprio privilégio de administrador local.",
    USER_NOT_FOUND: "A conta alvo está indisponível. Não foi possível confirmar seu status global.",
    VALIDATION_ERROR: "Confira os campos e filtros antes de tentar novamente.",
    SAME_CONDOMINIUM: "O destino coincide com a residência atual. A transferência não foi aprovada.",
    CONDOMINIUM_INACTIVE: "O condomínio de destino está inativo. A transferência não foi aprovada.",
  };
  if (!(erro instanceof ApiError)) return "Não foi possível concluir. Verifique sua conexão e tente novamente.";
  const mensagem = mensagens[erro.codigo] ?? "Não foi possível concluir. Verifique sua conexão e tente novamente.";
  if (erro.codigo === "VALIDATION_ERROR") {
    const detalhes = [...(erro.detalhes?.formErrors ?? []), ...Object.values(erro.detalhes?.fieldErrors ?? {}).flat()];
    return [mensagem, ...detalhes].join(" ");
  }
  return mensagem;
}
