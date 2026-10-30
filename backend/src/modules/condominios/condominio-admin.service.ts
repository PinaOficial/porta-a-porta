import { createHash } from "node:crypto";
import { prisma } from "../../lib/prisma.js";
import { ErroDominio } from "../../lib/erro-dominio.js";
import type { ContextoAutenticado } from "../../types/auth.js";
import { criarAuditoria } from "../auditoria/auditoria.repository.js";
import { consultarCondominioAdmin, consultarCondominiosAdmin, gravarCondominioAdmin, type CondominioVersionado } from "./condominio-admin.repository.js";
import type { EditarCondominioBody, ListarCondominiosAdminQuery, StatusCondominioBody } from "./condominio.schema.js";

function exigirSuper(auth: ContextoAutenticado | undefined): asserts auth is ContextoAutenticado {
  if (!auth) throw new ErroDominio("UNAUTHENTICATED", 401, "Autenticação necessária.");
  if (auth.super_admin !== true) throw new ErroDominio("FORBIDDEN", 403, "Acesso de super admin necessário.");
}
function representar(linha: CondominioVersionado) {
  const { revisao, ...dados } = linha;
  return { ...dados, created_at: dados.created_at.toISOString(),
    versao: createHash("sha256").update(JSON.stringify([revisao, dados])).digest("hex") };
}
function exigirExistente(linha: CondominioVersionado | null): asserts linha is CondominioVersionado {
  if (!linha) throw new ErroDominio("CONDOMINIO_NOT_FOUND", 404, "Condomínio não encontrado.");
}
export async function listarCondominiosAdmin(auth: ContextoAutenticado | undefined, filtros: ListarCondominiosAdminQuery) {
  exigirSuper(auth);
  return prisma.$transaction(async tx => {
    const { linhas, total } = await consultarCondominiosAdmin(tx, filtros);
    return { dados: linhas.map(representar), paginacao: { pagina: filtros.pagina, limite: filtros.limite, total, total_paginas: Math.ceil(total / filtros.limite) } };
  }, { isolationLevel: "RepeatableRead" });
}
export async function obterCondominioAdmin(auth: ContextoAutenticado | undefined, id: string) {
  exigirSuper(auth);
  return prisma.$transaction(async tx => {
    const linha = await consultarCondominioAdmin(tx, id); exigirExistente(linha);
    return { dados: representar(linha) };
  });
}
export async function alterarCondominioAdmin(auth: ContextoAutenticado | undefined, id: string, dados: EditarCondominioBody | StatusCondominioBody) {
  exigirSuper(auth);
  return prisma.$transaction(async tx => {
    // Mesma linha bloqueada pelas entradas residenciais em FOR SHARE.
    const anterior = await consultarCondominioAdmin(tx, id, true); exigirExistente(anterior);
    if (representar(anterior).versao !== dados.versao) {
      throw new ErroDominio("CONDOMINIUM_UPDATE_CONFLICT", 409, "Este condomínio foi alterado. Recarregue os dados antes de confirmar.");
    }
    const alteracoes: { nome_residencial?: string; cep?: string; endereco?: string; ativo?: boolean } = {};
    const antes: Record<string, string | boolean> = {}, depois: Record<string, string | boolean> = {};
    const status = "ativo" in dados;
    for (const campo of ["nome_residencial", "cep", "endereco", "ativo"] as const) {
      const valor = campo in dados ? (dados as Record<string, unknown>)[campo] : undefined;
      if (valor !== undefined && valor !== anterior[campo]) {
        Object.assign(alteracoes, { [campo]: valor }); antes[campo] = anterior[campo]; depois[campo] = valor as string | boolean;
      }
    }
    if (Object.keys(alteracoes).length > 0) {
      await gravarCondominioAdmin(tx, id, alteracoes);
      await criarAuditoria(tx, {
        id_ator: auth.id_usuario, acao: status ? (dados.ativo ? "ACTIVATE_CONDOMINIUM" : "DEACTIVATE_CONDOMINIUM") : "UPDATE_CONDOMINIUM",
        entidade: "condominio", entidade_id: id, id_condominio: id,
        metadata: { antes, depois, ...(status ? { motivo: dados.motivo } : {}) },
      });
    }
    const atualizado = await consultarCondominioAdmin(tx, id); exigirExistente(atualizado);
    return { dados: representar(atualizado) };
  }, { isolationLevel: "ReadCommitted" });
}
