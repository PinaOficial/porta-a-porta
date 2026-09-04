import "server-only";
import { prisma } from "@/lib/db/prisma";
import { normalizeEmail } from "@/lib/email";

export async function criarConviteAdmin(data: { email: string; condominioId: string; criadoPorUsuarioId: string }) {
  const email = normalizeEmail(data.email);
  const condominio = await prisma.condominios.findFirst({ where: { id: data.condominioId, ativo: true }, select: { id: true } });
  if (!condominio) return null;
  const usuario = await prisma.usuarios.findFirst({
    where: { users: { is: { email: { equals: email, mode: "insensitive" } } } },
    select: { id: true },
  });
  if (usuario) {
    const administrador = await prisma.usuario_condominios_admin.findFirst({
      where: {
        usuario_id: usuario.id,
        condominio_id: data.condominioId,
        ativo: true,
      },
      select: { id: true },
    });
    if (administrador) return "already-admin" as const;
  }
  const existing = await prisma.convites_admin.findFirst({ where: { email: { equals: email, mode: "insensitive" }, condominio_id: data.condominioId, ativo: true, consumido_em: null, cancelado_em: null }, select: { id: true } });
  if (existing) return "pending" as const;
  return prisma.convites_admin.create({ data: { email, condominio_id: data.condominioId, criado_por_usuario_id: data.criadoPorUsuarioId } });
}

export function listarConvitesAdminPendentes(condominioId?: string) {
  return prisma.convites_admin.findMany({
    where: {
      ...(condominioId ? { condominio_id: condominioId } : {}),
      ativo: true,
      consumido_em: null,
      cancelado_em: null,
    },
    select: {
      id: true,
      email: true,
      criado_em: true,
      condominios: { select: { id: true, nome: true } },
    },
    orderBy: { criado_em: "desc" },
  });
}

export async function cancelarConviteAdmin(conviteId: string) {
  const result = await prisma.convites_admin.updateMany({
    where: {
      id: conviteId,
      ativo: true,
      consumido_em: null,
      cancelado_em: null,
    },
    data: {
      ativo: false,
      cancelado_em: new Date(),
      atualizado_em: new Date(),
    },
  });
  return result.count > 0;
}
