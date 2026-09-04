import "server-only";

import { prisma } from "@/lib/db/prisma";
import { normalizeEmail } from "@/lib/email";

export type AppUserRecord = {
  id: string;
  email: string | null;
  condominoId: string | null;
  ativo: boolean;
  isSuperadmin: boolean;
};

export type CondominiumRoleResolution =
  | {
      role: "superadmin";
      vinculoId: string | null;
    }
  | {
      role: "admin";
      vinculoId: string | null;
    }
  | {
      role: "member";
      vinculoId: string;
    };

export async function buscarUsuarioAplicacaoPorId(
  userId: string,
): Promise<AppUserRecord | null> {
  const usuario = await prisma.usuarios.findUnique({
    where: {
      id: userId,
    },
    select: {
      id: true,
      condomino_id: true,
      ativo: true,
      users: {
        select: {
          email: true,
        },
      },
      superadmins: {
        select: {
          ativo: true,
        },
      },
    },
  });

  if (!usuario) {
    return null;
  }

  return {
    id: usuario.id,
    email: usuario.users.email,
    condominoId: usuario.condomino_id,
    ativo: usuario.ativo,
    isSuperadmin: usuario.superadmins?.ativo ?? false,
  };
}

export async function emailPodeAtivarConta(email: string) {
  const normalized = normalizeEmail(email);
  const [morador, convite] = await Promise.all([
    prisma.condominos.findFirst({ where: { email: { equals: normalized, mode: "insensitive" } }, select: { id: true } }),
    prisma.convites_admin.findFirst({ where: { email: { equals: normalized, mode: "insensitive" }, ativo: true, consumido_em: null, cancelado_em: null }, select: { id: true } }),
  ]);
  return Boolean(morador || convite);
}

export async function resolverPapelPorCondominio(
  user: AppUserRecord,
  condominioId: string,
): Promise<CondominiumRoleResolution | null> {
  const condominioAtivo = await prisma.condominios.findFirst({
    where: { id: condominioId, ativo: true },
    select: { id: true },
  });

  if (!condominioAtivo) {
    return null;
  }

  const membership = user.condominoId
    ? await prisma.condomino_apartamentos.findFirst({
        where: {
          condomino_id: user.condominoId,
          condominio_id: condominioId,
          ativo: true,
          apartamentos: {
            is: {
              ativo: true,
              condominios: { is: { ativo: true } },
            },
          },
        },
        select: { id: true },
      })
    : null;

  if (user.isSuperadmin) {
    return {
      role: "superadmin",
      vinculoId: membership?.id ?? null,
    };
  }

  const admin = await prisma.usuario_condominios_admin.findFirst({
    where: {
      usuario_id: user.id,
      condominio_id: condominioId,
      ativo: true,
      condominios: {
        is: {
          ativo: true,
        },
      },
    },
    select: {
      id: true,
    },
  });

  if (admin) {
    return {
      role: "admin",
      vinculoId: membership?.id ?? null,
    };
  }

  if (!membership) {
    return null;
  }

  return {
    role: "member",
    vinculoId: membership.id,
  };
}

export async function listarCondominiosAcessiveisPorUsuario(user: AppUserRecord) {
  if (user.isSuperadmin) {
    const [condominios, memberships] = await Promise.all([
      prisma.condominios.findMany({
        where: { ativo: true },
        orderBy: { nome: "asc" },
        select: { id: true, nome: true, cidade: true, uf: true },
      }),
      user.condominoId
        ? prisma.condomino_apartamentos.findMany({
            where: {
              condomino_id: user.condominoId,
              ativo: true,
              apartamentos: { is: { ativo: true } },
            },
            select: { condominio_id: true },
          })
        : Promise.resolve([]),
    ]);
    const membershipIds = new Set(
      memberships.map((membership) => membership.condominio_id),
    );

    return condominios.map((condominio) => ({
      id: condominio.id,
      nome: condominio.nome,
      cidade: condominio.cidade,
      uf: condominio.uf,
      role: "superadmin" as const,
      hasMembership: membershipIds.has(condominio.id),
    }));
  }

  const rolesByCondominiumId = new Map<string, "member" | "admin">();
  const membershipIds = new Set<string>();

  if (user.condominoId) {
    const memberships = await prisma.condomino_apartamentos.findMany({
      where: {
        condomino_id: user.condominoId,
        ativo: true,
        apartamentos: {
          is: {
            ativo: true,
            condominios: {
              is: {
                ativo: true,
              },
            },
          },
        },
      },
      select: {
        condominio_id: true,
      },
    });

    memberships.forEach((membership) => {
      rolesByCondominiumId.set(membership.condominio_id, "member");
      membershipIds.add(membership.condominio_id);
    });
  }

  const adminAssignments = await prisma.usuario_condominios_admin.findMany({
    where: {
      usuario_id: user.id,
      ativo: true,
      condominios: {
        is: {
          ativo: true,
        },
      },
    },
    select: {
      condominio_id: true,
    },
  });

  adminAssignments.forEach((adminAssignment) => {
    rolesByCondominiumId.set(adminAssignment.condominio_id, "admin");
  });

  if (rolesByCondominiumId.size === 0) {
    return [];
  }

  const condominios = await prisma.condominios.findMany({
    where: {
      id: {
        in: [...rolesByCondominiumId.keys()],
      },
      ativo: true,
    },
    orderBy: { nome: "asc" },
    select: {
      id: true,
      nome: true,
      cidade: true,
      uf: true,
    },
  });

  return condominios.map((condominio) => ({
    id: condominio.id,
    nome: condominio.nome,
    cidade: condominio.cidade,
    uf: condominio.uf,
    role: rolesByCondominiumId.get(condominio.id) ?? "member",
    hasMembership: membershipIds.has(condominio.id),
  }));
}
