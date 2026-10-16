import { prisma } from "../../lib/prisma.js";
import { ErroDominio } from "../../lib/erro-dominio.js";
import type { ContextoAutenticado } from "../../types/auth.js";
import { criarAuditoria } from "../auditoria/auditoria.repository.js";
import { obterEscopoAdministrativo, revalidarAdminAtivo, validarCondominioAdministrativo } from "../vinculos/vinculo.service.js";
import { buscarAdminVinculoAposAlteracao, atualizarAdminVinculo, bloquearAdministracaoCondominios, bloquearVinculoParaAdministracao, buscarVinculoParaAnalise, listarVinculosAdministrativos } from "../vinculos/vinculo.repository.js";
import type { AtualizarAdminVinculoBody, ListarVinculosQuery } from "./administracao.schema.js";
import type { ListaVinculosAdministrativos, ResultadoAdminVinculo } from "./administracao.model.js";
import { criarCondominio } from "../condominios/condominio.repository.js";
import type { CriarCondominioBody } from "../condominios/condominio.schema.js";
import type { ResultadoCriacaoCondominio } from "../condominios/condominio.model.js";

export async function cadastrarCondominioAdmin(
  auth: ContextoAutenticado | undefined, dados: CriarCondominioBody,
): Promise<ResultadoCriacaoCondominio> {
  if (!auth) throw new ErroDominio("UNAUTHENTICATED", 401, "Autenticação necessária.");
  if (auth.super_admin !== true) throw new ErroDominio("FORBIDDEN", 403, "Acesso de super admin necessário.");
  return prisma.$transaction(async (tx) => {
    const condominio = await criarCondominio(tx, dados);
    await criarAuditoria(tx, {
      id_ator: auth.id_usuario, acao: "CREATE_CONDOMINIUM", entidade: "condominio",
      entidade_id: condominio.id_condominio, id_condominio: condominio.id_condominio,
      metadata: { ativo: condominio.ativo },
    });
    return { dados: { ...condominio, created_at: condominio.created_at.toISOString() } };
  }, { isolationLevel: "ReadCommitted" });
}

export async function listarVinculosAdmin(auth: ContextoAutenticado | undefined, filtros: ListarVinculosQuery): Promise<ListaVinculosAdministrativos> {
  const escopo = obterEscopoAdministrativo(auth);
  validarCondominioAdministrativo(escopo.idCondominio, filtros.id_condominio);
  return prisma.$transaction(async (tx) => {
    const { vinculos, total } = await listarVinculosAdministrativos(tx, {
      ...filtros, id_condominio: escopo.idCondominio ?? filtros.id_condominio,
      deslocamento: (filtros.pagina - 1) * filtros.limite,
    });
    return {
      dados: vinculos.map((v) => ({
        id_vinculo: v.id_vinculo, status_vinculo: v.status_vinculo, moradia: v.moradia, admin_condominio: v.admin_condominio,
        data_solicitacao: v.data_solicitacao.toISOString(), data_inicio: v.data_inicio?.toISOString() ?? null,
        morador: { id_usuario: v.condomino.id_condomino, nome_completo: v.condomino.nome_completo }, condominio: v.condominio,
      })),
      paginacao: { pagina: filtros.pagina, limite: filtros.limite, total, total_paginas: Math.ceil(total / filtros.limite) },
    };
  }, { isolationLevel: "RepeatableRead" });
}

export async function alterarAdminVinculo(
  auth: ContextoAutenticado | undefined, idVinculo: string, dados: AtualizarAdminVinculoBody,
): Promise<ResultadoAdminVinculo> {
  const escopo = obterEscopoAdministrativo(auth);
  return prisma.$transaction(async (tx) => {
    const inicial = await buscarVinculoParaAnalise(tx, idVinculo);
    if (!inicial) throw new ErroDominio("MEMBERSHIP_NOT_FOUND", 404, "Vínculo não encontrado.");
    validarCondominioAdministrativo(escopo.idCondominio, inicial.id_condominio);
    if (!auth!.super_admin && inicial.id_condomino === auth!.id_usuario) {
      throw new ErroDominio("SELF_ADMIN_CHANGE_FORBIDDEN", 403, "Admin local só pode alterar outro vínculo.");
    }
    await bloquearAdministracaoCondominios(tx, [inicial.id_condominio]);
    await revalidarAdminAtivo(tx, auth!);
    await bloquearVinculoParaAdministracao(tx, idVinculo);
    const alvo = await buscarVinculoParaAnalise(tx, idVinculo);
    if (!alvo || alvo.status_vinculo !== "ATIVO") throw new ErroDominio("MEMBERSHIP_NOT_ACTIVE", 409, "Vínculo não está ativo.");
    if (alvo.admin_condominio !== dados.admin_condominio) {
      const instante = new Date();
      const atualizacao = await atualizarAdminVinculo(tx, idVinculo, dados.admin_condominio, escopo.idUsuario, instante);
      if (atualizacao.count !== 1) throw new ErroDominio("MEMBERSHIP_NOT_ACTIVE", 409, "Vínculo alterado por outra operação.");
      await criarAuditoria(tx, {
        id_ator: escopo.idUsuario, acao: "UPDATE_MEMBERSHIP_ADMIN", entidade: "vinculo_condominio", entidade_id: idVinculo,
        id_condominio: alvo.id_condominio, created_at: instante,
        metadata: { admin_anterior: alvo.admin_condominio, admin_novo: dados.admin_condominio },
      });
    }
    const atualizado = await buscarAdminVinculoAposAlteracao(tx, idVinculo);
    return { dados: { ...atualizado, admin_atualizado_em: atualizado.admin_atualizado_em?.toISOString() ?? null } };
  }, { isolationLevel: "ReadCommitted" });
}
