import "server-only";

import { prisma } from "@/lib/db/prisma";

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
      vinculoId: null;
    }
  | {
      role: "admin";
      vinculoId: null;
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

  if (user.isSuperadmin) {
    return {
      role: "superadmin",
      vinculoId: null,
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
      vinculoId: null,
    };
  }

  if (!user.condominoId) {
    return null;
  }

  const membership = await prisma.condomino_apartamentos.findFirst({
    where: {
      condomino_id: user.condominoId,
      condominio_id: condominioId,
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
      id: true,
    },
  });

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
    const condominios = await prisma.condominios.findMany({
      where: {
        ativo: true,
      },
      orderBy: {
        criado_em: "desc",
      },
      select: {
        id: true,
        nome: true,
      },
    });

    return condominios.map((condominio) => ({
      id: condominio.id,
      nome: condominio.nome,
      role: "superadmin" as const,
    }));
  }

  const rolesByCondominiumId = new Map<string, "member" | "admin">();

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
    orderBy: {
      criado_em: "desc",
    },
    select: {
      id: true,
      nome: true,
    },
  });

  return condominios.map((condominio) => ({
    id: condominio.id,
    nome: condominio.nome,
    role: rolesByCondominiumId.get(condominio.id) ?? "member",
  }));
}
