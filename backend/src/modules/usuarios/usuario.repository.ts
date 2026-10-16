import { prisma } from "../../lib/prisma.js";
import type { Prisma, status_conta_enum } from "../../generated/prisma/client.js";
import type { OnboardingBody } from "./usuario.schema.js";

export function buscarUsuarioParaAutenticacao(idUsuario: string) {
  return prisma.usuario.findUnique({
    where: { id_usuario: idUsuario },
    select: {
      id_usuario: true,
      status_conta: true,
      super_admin: { select: { id_super_admin: true } },
    },
  });
}

export function buscarUsuarioPorId(idUsuario: string) {
  return prisma.usuario.findUnique({
    where: { id_usuario: idUsuario },
    select: { id_usuario: true },
  });
}

export function buscarCondominoPorCpf(cpf: string) {
  return prisma.condomino.findUnique({
    where: { cpf },
    select: { id_condomino: true },
  });
}

export function buscarUsuarioPorEmail(email: string) {
  // Igualdade literal no índice funcional: e-mails com '_' ou '%' não são padrões de busca.
  return prisma.$queryRaw<{ id_usuario: string }[]>`
    SELECT id_usuario FROM usuario WHERE lower(email) = ${email} LIMIT 1
  `;
}

export function criarUsuarioDoOnboarding(tx: Prisma.TransactionClient, idUsuario: string, email: string) {
  return tx.usuario.create({
    data: { id_usuario: idUsuario, email, status_conta: "ATIVA" },
    select: { id_usuario: true },
  });
}

export function criarCondominoDoOnboarding(tx: Prisma.TransactionClient, idUsuario: string, dados: OnboardingBody) {
  return tx.condomino.create({
    data: {
      id_condomino: idUsuario,
      nome_completo: dados.nome_completo,
      cpf: dados.cpf,
      data_nascimento: dados.data_nascimento,
    },
    select: { nome_completo: true },
  });
}

export async function buscarUsuarioBloqueadoParaStatus(tx: Prisma.TransactionClient, idUsuario: string) {
  const usuarios = await tx.$queryRaw<{ id_usuario: string; status_conta: status_conta_enum }[]>`
    SELECT id_usuario, status_conta FROM public.usuario WHERE id_usuario = ${idUsuario}::uuid FOR UPDATE
  `;
  return usuarios[0] ?? null;
}

export function atualizarStatusConta(tx: Prisma.TransactionClient, idUsuario: string, status: status_conta_enum) {
  return tx.usuario.update({ where: { id_usuario: idUsuario }, data: { status_conta: status }, select: { id_usuario: true, status_conta: true } });
}

export function buscarMeuUsuario(idUsuario: string) {
  return prisma.usuario.findUnique({
    where: { id_usuario: idUsuario },
    select: { id_usuario: true, condomino: { select: { nome_completo: true } }, super_admin: { select: { id_super_admin: true } } },
  });
}
