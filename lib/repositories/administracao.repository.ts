import "server-only";

import type {
  AdministracaoAdminDto,
  AdministracaoUsuarioDto,
  AdministracaoVinculoDto,
} from "@/lib/dtos/administracao";
import { prisma } from "@/lib/db/prisma";

type MutableUsuario = AdministracaoUsuarioDto;

function fallbackName(email: string | null) {
  return email?.split("@")[0] || "Usuário sem nome";
}

function ensureUsuario(
  rows: Map<string, MutableUsuario>,
  data: {
    usuarioId: string | null;
    condominoId: string | null;
    nome: string | null;
    email: string | null;
    contaAtiva: boolean | null;
    isSuperadmin: boolean;
  },
) {
  const key = data.usuarioId ?? `condomino:${data.condominoId}`;
  const existing = rows.get(key);

  if (existing) {
    if (data.nome) existing.nome = data.nome;
    if (data.email) existing.email = data.email;
    if (data.condominoId) existing.condominoId = data.condominoId;
    return existing;
  }

  const row: MutableUsuario = {
    key,
    usuarioId: data.usuarioId,
    condominoId: data.condominoId,
    nome: data.nome ?? fallbackName(data.email),
    email: data.email,
    contaAtiva: data.contaAtiva,
    isSuperadmin: data.isSuperadmin,
    vinculos: [],
    administracoes: [],
  };
  rows.set(key, row);
  return row;
}

function sortUsuarios(rows: Map<string, MutableUsuario>) {
  return [...rows.values()].sort((a, b) =>
    a.nome.localeCompare(b.nome, "pt-BR", { sensitivity: "base" }),
  );
}

export async function listarUsuariosDoCondominio(
  condominioId: string,
  includeInactive: boolean,
) {
  const [vinculos, administradores] = await Promise.all([
    prisma.condomino_apartamentos.findMany({
      where: {
        condominio_id: condominioId,
        ...(includeInactive ? {} : { ativo: true }),
      },
      select: {
        id: true,
        tipo_vinculo: true,
        ativo: true,
        condominos: {
          select: {
            id: true,
            nome: true,
            email: true,
            usuarios: {
              select: {
                id: true,
                ativo: true,
                users: { select: { email: true } },
                superadmins: { select: { ativo: true } },
              },
            },
          },
        },
        apartamentos: {
          select: {
            id: true,
            bloco: true,
            numero: true,
            condominios: { select: { id: true, nome: true } },
          },
        },
      },
      orderBy: { criado_em: "desc" },
    }),
    prisma.usuario_condominios_admin.findMany({
      where: {
        condominio_id: condominioId,
        ...(includeInactive ? {} : { ativo: true }),
      },
      select: {
        id: true,
        ativo: true,
        condominios: { select: { id: true, nome: true } },
        usuarios: {
          select: {
            id: true,
            ativo: true,
            users: { select: { email: true } },
            superadmins: { select: { ativo: true } },
            condominos: { select: { id: true, nome: true } },
          },
        },
      },
      orderBy: { criado_em: "desc" },
    }),
  ]);

  const rows = new Map<string, MutableUsuario>();

  for (const vinculo of vinculos) {
    const account = vinculo.condominos.usuarios;
    const row = ensureUsuario(rows, {
      usuarioId: account?.id ?? null,
      condominoId: vinculo.condominos.id,
      nome: vinculo.condominos.nome,
      email: account?.users.email ?? vinculo.condominos.email,
      contaAtiva: account?.ativo ?? null,
      isSuperadmin: account?.superadmins?.ativo ?? false,
    });
    const dto: AdministracaoVinculoDto = {
      vinculoId: vinculo.id,
      condominio: vinculo.apartamentos.condominios,
      apartamento: {
        id: vinculo.apartamentos.id,
        bloco: vinculo.apartamentos.bloco,
        numero: vinculo.apartamentos.numero,
      },
      tipoVinculo: vinculo.tipo_vinculo,
      ativo: vinculo.ativo,
    };
    row.vinculos.push(dto);
  }

  for (const administrador of administradores) {
    const row = ensureUsuario(rows, {
      usuarioId: administrador.usuarios.id,
      condominoId: administrador.usuarios.condominos?.id ?? null,
      nome: administrador.usuarios.condominos?.nome ?? null,
      email: administrador.usuarios.users.email,
      contaAtiva: administrador.usuarios.ativo,
      isSuperadmin: administrador.usuarios.superadmins?.ativo ?? false,
    });
    const dto: AdministracaoAdminDto = {
      administradorId: administrador.id,
      condominio: administrador.condominios,
      ativo: administrador.ativo,
    };
    row.administracoes.push(dto);
  }

  return sortUsuarios(rows);
}

export async function listarUsuariosGlobais(includeInactive: boolean) {
  const [usuarios, condominos, administradores] = await Promise.all([
    prisma.usuarios.findMany({
      where: includeInactive ? {} : { ativo: true },
      select: {
        id: true,
        ativo: true,
        users: { select: { email: true } },
        superadmins: { select: { ativo: true } },
        condominos: { select: { id: true, nome: true } },
      },
    }),
    prisma.condominos.findMany({
      select: {
        id: true,
        nome: true,
        email: true,
        usuarios: {
          select: {
            id: true,
            ativo: true,
            users: { select: { email: true } },
            superadmins: { select: { ativo: true } },
          },
        },
        condomino_apartamentos: {
          where: includeInactive ? {} : { ativo: true },
          select: {
            id: true,
            tipo_vinculo: true,
            ativo: true,
            apartamentos: {
              select: {
                id: true,
                bloco: true,
                numero: true,
                condominios: { select: { id: true, nome: true } },
              },
            },
          },
        },
      },
    }),
    prisma.usuario_condominios_admin.findMany({
      where: includeInactive ? {} : { ativo: true },
      select: {
        id: true,
        ativo: true,
        condominios: { select: { id: true, nome: true } },
        usuarios: { select: { id: true } },
      },
    }),
  ]);

  const rows = new Map<string, MutableUsuario>();

  for (const usuario of usuarios) {
    ensureUsuario(rows, {
      usuarioId: usuario.id,
      condominoId: usuario.condominos?.id ?? null,
      nome: usuario.condominos?.nome ?? null,
      email: usuario.users.email,
      contaAtiva: usuario.ativo,
      isSuperadmin: usuario.superadmins?.ativo ?? false,
    });
  }

  for (const condomino of condominos) {
    const account = condomino.usuarios;
    const row = ensureUsuario(rows, {
      usuarioId: account?.id ?? null,
      condominoId: condomino.id,
      nome: condomino.nome,
      email: account?.users.email ?? condomino.email,
      contaAtiva: account?.ativo ?? null,
      isSuperadmin: account?.superadmins?.ativo ?? false,
    });
    for (const vinculo of condomino.condomino_apartamentos) {
      row.vinculos.push({
        vinculoId: vinculo.id,
        condominio: vinculo.apartamentos.condominios,
        apartamento: {
          id: vinculo.apartamentos.id,
          bloco: vinculo.apartamentos.bloco,
          numero: vinculo.apartamentos.numero,
        },
        tipoVinculo: vinculo.tipo_vinculo,
        ativo: vinculo.ativo,
      });
    }
  }

  for (const administrador of administradores) {
    const row = rows.get(administrador.usuarios.id);
    if (row) {
      row.administracoes.push({
        administradorId: administrador.id,
        condominio: administrador.condominios,
        ativo: administrador.ativo,
      });
    }
  }

  return sortUsuarios(rows);
}

export async function desativarUsuario(usuarioId: string) {
  const result = await prisma.usuarios.updateMany({
    where: { id: usuarioId, ativo: true },
    data: {
      ativo: false,
      desativado_em: new Date(),
      atualizado_em: new Date(),
    },
  });
  return result.count > 0;
}

export async function revogarAdministrador(administradorId: string) {
  const result = await prisma.usuario_condominios_admin.updateMany({
    where: { id: administradorId, ativo: true },
    data: {
      ativo: false,
      revogado_em: new Date(),
      atualizado_em: new Date(),
    },
  });
  return result.count > 0;
}
