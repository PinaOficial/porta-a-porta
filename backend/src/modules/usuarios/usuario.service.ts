import { Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../../lib/prisma.js";
import { ErroDominio } from "../../lib/erro-dominio.js";
import { identificadoresDaConstraint } from "../../lib/erro-prisma.js";
import type { ContextoAutenticado } from "../../types/auth.js";
import { buscarCondominioAtivoPorId } from "../condominios/condominio.repository.js";
import { criarVinculoPendenteDoOnboarding } from "../vinculos/vinculo.repository.js";
import {
  buscarUsuarioPorId, buscarCondominoPorCpf, buscarUsuarioPorEmail,
  criarUsuarioDoOnboarding, criarCondominoDoOnboarding,
} from "./usuario.repository.js";
import type { OnboardingBody } from "./usuario.schema.js";
import type { ResultadoOnboarding, ResultadoStatusConta } from "./usuario.model.js";

import type { AtualizarStatusContaBody } from "./usuario.schema.js";
import { atualizarStatusConta, buscarUsuarioBloqueadoParaStatus } from "./usuario.repository.js";
import { criarAuditoria } from "../auditoria/auditoria.repository.js";
import { buscarMeuUsuario } from "./usuario.repository.js";
import type { MeuUsuario } from "./usuario.model.js";

export async function consultarMeuUsuario(auth: ContextoAutenticado | undefined): Promise<MeuUsuario> {
  if (!auth) throw new ErroDominio("UNAUTHENTICATED", 401, "Autenticação necessária.");
  const usuario = await buscarMeuUsuario(auth.id_usuario);
  return { dados: {
    id_usuario: auth.id_usuario, nome_completo: usuario?.condomino?.nome_completo ?? null,
    onboarding_realizado: usuario !== null, super_admin: usuario?.super_admin != null,
  } };
}

function mapearConflitoDoOnboarding(erro: unknown): never {
  if (erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === "P2002") {
    const constraints = identificadoresDaConstraint(erro);
    if (constraints.some((nome) => nome === "usuario_pkey" || nome === "id_usuario")) {
      throw new ErroDominio("ONBOARDING_ALREADY_COMPLETED", 409, "Onboarding já realizado.");
    }
    if (constraints.some((nome) => nome === "condomino_cpf_key" || nome === "cpf")) {
      throw new ErroDominio("CPF_ALREADY_REGISTERED", 409, "CPF já cadastrado.");
    }
    if (constraints.some((nome) => nome === "usuario_email_unique_ci" || nome === "email")) {
      throw new ErroDominio("EMAIL_ALREADY_REGISTERED", 409, "E-mail já cadastrado.");
    }
  }
  throw erro;
}

export async function realizarOnboarding(
  auth: ContextoAutenticado | undefined,
  dados: OnboardingBody,
): Promise<ResultadoOnboarding> {
  if (!auth) throw new ErroDominio("UNAUTHENTICATED", 401, "Autenticação necessária.");
  if (auth.super_admin) {
    throw new ErroDominio("SUPER_ADMIN_CANNOT_ONBOARD", 403, "Super admin não realiza onboarding residencial.");
  }
  if (await buscarUsuarioPorId(auth.id_usuario)) {
    throw new ErroDominio("ONBOARDING_ALREADY_COMPLETED", 409, "Onboarding já realizado.");
  }
  if (!auth.email) {
    throw new ErroDominio("AUTH_EMAIL_REQUIRED", 403, "E-mail válido da identidade autenticada é necessário.");
  }
  const email = auth.email.trim().toLowerCase();
  if (await buscarCondominoPorCpf(dados.cpf)) {
    throw new ErroDominio("CPF_ALREADY_REGISTERED", 409, "CPF já cadastrado.");
  }
  if ((await buscarUsuarioPorEmail(email)).length > 0) {
    throw new ErroDominio("EMAIL_ALREADY_REGISTERED", 409, "E-mail já cadastrado.");
  }
  if (!await buscarCondominioAtivoPorId(dados.id_condominio)) {
    throw new ErroDominio("CONDOMINIO_NOT_FOUND", 404, "Condomínio não encontrado.");
  }

  try {
    return await prisma.$transaction(async (tx) => {
      const usuario = await criarUsuarioDoOnboarding(tx, auth.id_usuario, email);
      const condomino = await criarCondominoDoOnboarding(tx, auth.id_usuario, dados);
      const vinculo = await criarVinculoPendenteDoOnboarding(tx, auth.id_usuario, dados);
      return { dados: { ...usuario, ...condomino, ...vinculo } };
    });
  } catch (erro: unknown) {
    mapearConflitoDoOnboarding(erro);
  }
}

export async function alterarStatusConta(
  auth: ContextoAutenticado | undefined, idUsuario: string, dados: AtualizarStatusContaBody,
): Promise<ResultadoStatusConta> {
  if (!auth) throw new ErroDominio("UNAUTHENTICATED", 401, "Autenticação necessária.");
  if (!auth.super_admin) throw new ErroDominio("FORBIDDEN", 403, "Acesso de super admin necessário.");
  return prisma.$transaction(async (tx) => {
    const usuario = await buscarUsuarioBloqueadoParaStatus(tx, idUsuario);
    if (!usuario) throw new ErroDominio("USER_NOT_FOUND", 404, "Usuário não encontrado.");
    if (usuario.status_conta === dados.status_conta) return { dados: usuario };
    const atualizado = await atualizarStatusConta(tx, idUsuario, dados.status_conta);
    await criarAuditoria(tx, {
      id_ator: auth.id_usuario, acao: "UPDATE_USER_STATUS", entidade: "usuario", entidade_id: idUsuario,
      metadata: { status_anterior: usuario.status_conta, status_novo: dados.status_conta },
    });
    return { dados: atualizado };
  }, { isolationLevel: "ReadCommitted" });
}
