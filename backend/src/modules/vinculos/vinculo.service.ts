import { ErroDominio } from "../../lib/erro-dominio.js";
import { identificadoresDaConstraint } from "../../lib/erro-prisma.js";
import { prisma } from "../../lib/prisma.js";
import { Prisma } from "../../generated/prisma/client.js";
import type { ContextoAutenticado } from "../../types/auth.js";
import { criarAuditoria } from "../auditoria/auditoria.repository.js";
import type { ListaVinculosPendentes, ResultadoAprovacaoVinculo, ResultadoRejeicaoVinculo, ResultadoSuspensaoVinculo, SituacaoResidencial, VinculoSituacaoResidencial } from "./vinculo.model.js";
import {
  atualizarVinculoAtivoParaSuspenso, atualizarVinculoPendenteParaAtivo, atualizarVinculoPendenteParaRejeitado,
  buscarOutroVinculoAtivo, buscarVinculoAposDecisao, buscarVinculoParaAnalise,
  buscarSituacaoResidencialDoUsuario, buscarVinculosPendentes, type VinculoConsultado,
} from "./vinculo.repository.js";
import type { ListarVinculosPendentesQuery } from "./vinculo.schema.js";
import type { SolicitarTransferenciaBody } from "./vinculo.schema.js";
import type { ResultadoSolicitacaoTransferencia } from "./vinculo.model.js";
import { obterVinculoAtivo } from "../../lib/autorizacao-vitrine.js";
import { buscarCondominioParaTransferencia } from "../condominios/condominio.repository.js";
import { buscarPedidoAbertoDoVinculo, buscarVinculoBloqueadoParaPedido } from "../pedidos/pedido.repository.js";
import { desativarProdutosDoVinculo } from "../produtos/produto.repository.js";
import {
  bloquearAdministracaoCondominios, bloquearPerfilParaTransferencia, bloquearVinculoParaAdministracao, buscarAdminComBloqueio,
  buscarOutrosAdminsAtivosComBloqueio, buscarSolicitacaoPendente, buscarVinculoAtivoParaTransferencia,
  criarSolicitacaoTransferencia, encerrarVinculoTransferido,
} from "./vinculo.repository.js";

export function obterEscopoAdministrativo(auth: ContextoAutenticado | undefined) {
  if (!auth) throw new ErroDominio("UNAUTHENTICATED", 401, "Autenticação necessária.");
  if (auth.super_admin) return { idUsuario: auth.id_usuario, idCondominio: undefined };
  if (!auth.vinculo_ativo?.admin_condominio) {
    throw new ErroDominio("FORBIDDEN", 403, "Acesso administrativo necessário.");
  }
  return { idUsuario: auth.id_usuario, idCondominio: auth.vinculo_ativo.id_condominio };
}

export function validarCondominioAdministrativo(idPermitido: string | undefined, idAlvo: string | undefined) {
  if (idPermitido && idAlvo && idPermitido.toLowerCase() !== idAlvo.toLowerCase()) {
    throw new ErroDominio("FORBIDDEN_CROSS_TENANT", 403, "Acesso restrito ao próprio condomínio.");
  }
}

export async function revalidarAdminAtivo(tx: Prisma.TransactionClient, auth: ContextoAutenticado) {
  if (auth.super_admin) return;
  const ator = auth.vinculo_ativo && await buscarAdminComBloqueio(tx, auth.vinculo_ativo.id_vinculo);
  if (!ator || ator.id_condomino !== auth.id_usuario || ator.status_vinculo !== "ATIVO" || !ator.admin_condominio
    || ator.id_condominio !== auth.vinculo_ativo!.id_condominio) {
    throw new ErroDominio("FORBIDDEN", 403, "Acesso administrativo necessário.");
  }
}

export async function solicitarTransferencia(auth: ContextoAutenticado | undefined, dados: SolicitarTransferenciaBody): Promise<ResultadoSolicitacaoTransferencia> {
  obterVinculoAtivo(auth);
  try {
    return await prisma.$transaction(async (tx) => {
      // Serializa solicitações da mesma pessoa sem depender só do índice parcial.
      await bloquearPerfilParaTransferencia(tx, auth!.id_usuario);
      const atual = await buscarVinculoAtivoParaTransferencia(tx, auth!.id_usuario);
      const bloqueado = atual && await buscarVinculoBloqueadoParaPedido(tx, atual.id_vinculo);
      if (!bloqueado || bloqueado.status_vinculo !== "ATIVO") throw new ErroDominio("MEMBERSHIP_REQUIRED", 403, "Um vínculo ativo é necessário para solicitar transferência.");
      const destino = await buscarCondominioParaTransferencia(tx, dados.id_condominio);
      if (!destino) throw new ErroDominio("CONDOMINIUM_NOT_FOUND", 404, "Condomínio não encontrado.");
      if (!destino.ativo) throw new ErroDominio("CONDOMINIUM_INACTIVE", 409, "Condomínio de destino inativo.");
      if (destino.id_condominio === bloqueado.id_condominio) throw new ErroDominio("SAME_CONDOMINIUM", 409, "Escolha um condomínio diferente do atual.");
      if (await buscarSolicitacaoPendente(tx, auth!.id_usuario)) throw new ErroDominio("MEMBERSHIP_PENDING", 409, "Já existe uma solicitação pendente.");
      const novo = await criarSolicitacaoTransferencia(tx, auth!.id_usuario, dados);
      return { dados: { ...novo, data_solicitacao: novo.data_solicitacao.toISOString() } };
    }, { isolationLevel: "ReadCommitted" });
  } catch (erro: unknown) {
    if (erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === "P2002"
      && identificadoresDaConstraint(erro).some((nome) => nome === "one_pending_membership_per_user" || nome === "id_condomino")) {
      throw new ErroDominio("MEMBERSHIP_PENDING", 409, "Já existe uma solicitação pendente.");
    }
    throw erro;
  }
}

async function prepararTransferencia(
  tx: Prisma.TransactionClient, auth: ContextoAutenticado, escopo: ReturnType<typeof obterEscopoAdministrativo>,
  alvo: NonNullable<Awaited<ReturnType<typeof buscarVinculoParaAnalise>>>,
  outro: NonNullable<Awaited<ReturnType<typeof buscarOutroVinculoAtivo>>>, instante: Date,
) {
  await bloquearAdministracaoCondominios(tx, [outro.id_condominio, alvo.id_condominio]);
  await revalidarAdminAtivo(tx, auth);
  // Revalidar depois do mutex impede que o segundo clique mova o vínculo novamente.
  await buscarPendenteAutorizado(tx, escopo, alvo.id_vinculo);
  await bloquearVinculoParaAdministracao(tx, outro.id_vinculo);
  const antigo = await buscarVinculoParaAnalise(tx, outro.id_vinculo);
  if (!antigo || antigo.status_vinculo !== "ATIVO" || antigo.id_condomino !== alvo.id_condomino) {
    throw new ErroDominio("MEMBERSHIP_NOT_ACTIVE", 409, "Vínculo anterior não está ativo.");
  }
  if (antigo.id_condominio === alvo.id_condominio) throw new ErroDominio("SAME_CONDOMINIUM", 409, "Destino igual ao condomínio atual.");
  const destino = await buscarCondominioParaTransferencia(tx, alvo.id_condominio);
  if (!destino?.ativo) throw new ErroDominio("CONDOMINIUM_INACTIVE", 409, "Condomínio de destino inativo.");
  // O lock exclusivo aguarda todos os FOR SHARE usados pelo POST /pedidos.
  // Em ReadCommitted, esta consulta já vê os pedidos confirmados antes de obter o lock.
  if (await buscarPedidoAbertoDoVinculo(tx, antigo.id_vinculo)) {
    throw new ErroDominio("OPEN_ORDERS_BLOCK_TRANSFER", 409, "Pedidos abertos impedem concluir a transferência.");
  }
  if (antigo.admin_condominio && !auth.super_admin
    && (await buscarOutrosAdminsAtivosComBloqueio(tx, antigo.id_condominio, antigo.id_vinculo)).length === 0) {
    throw new ErroDominio("LAST_ACTIVE_ADMIN", 409, "O último administrador ativo precisa de substituto.");
  }
  await desativarProdutosDoVinculo(tx, antigo.id_vinculo);
  if ((await encerrarVinculoTransferido(tx, antigo.id_vinculo, instante)).count !== 1) {
    throw new ErroDominio("MEMBERSHIP_NOT_ACTIVE", 409, "Vínculo anterior não está ativo.");
  }
  return antigo;
}

async function buscarVinculoAutorizado(
  tx: Prisma.TransactionClient, escopo: ReturnType<typeof obterEscopoAdministrativo>, idVinculo: string,
) {
  const alvo = await buscarVinculoParaAnalise(tx, idVinculo);
  if (!alvo) throw new ErroDominio("MEMBERSHIP_NOT_FOUND", 404, "Vínculo não encontrado.");
  validarCondominioAdministrativo(escopo.idCondominio, alvo.id_condominio);
  return alvo;
}

async function buscarPendenteAutorizado(
  tx: Prisma.TransactionClient, escopo: ReturnType<typeof obterEscopoAdministrativo>, idVinculo: string,
) {
  const alvo = await buscarVinculoAutorizado(tx, escopo, idVinculo);
  if (alvo.status_vinculo !== "PENDENTE") {
    throw new ErroDominio("MEMBERSHIP_NOT_PENDING", 409, "Vínculo não está pendente.");
  }
  return alvo;
}

export async function suspenderVinculo(
  auth: ContextoAutenticado | undefined, idVinculo: string,
): Promise<ResultadoSuspensaoVinculo> {
  const escopo = obterEscopoAdministrativo(auth);
  // ReadCommitted reavalia ATIVO após esperar uma suspensão concorrente.
  return prisma.$transaction(async (tx) => {
    const alvo = await buscarVinculoAutorizado(tx, escopo, idVinculo);
    if (alvo.status_vinculo !== "ATIVO") {
      throw new ErroDominio("MEMBERSHIP_NOT_ACTIVE", 409, "Vínculo não está ativo.");
    }
    const atualizacao = await atualizarVinculoAtivoParaSuspenso(tx, alvo.id_vinculo, alvo.id_condominio);
    if (atualizacao.count !== 1) {
      throw new ErroDominio("MEMBERSHIP_NOT_ACTIVE", 409, "Vínculo não está ativo.");
    }
    await criarAuditoria(tx, {
      id_ator: escopo.idUsuario, acao: "SUSPEND_MEMBERSHIP", entidade: "vinculo_condominio",
      entidade_id: alvo.id_vinculo, id_condominio: alvo.id_condominio, created_at: new Date(),
      metadata: { status_anterior: "ATIVO", status_novo: "SUSPENSO" },
    });
    const vinculo = await buscarVinculoAposDecisao(tx, alvo.id_vinculo);
    return { dados: {
      id_vinculo: vinculo.id_vinculo, status_vinculo: vinculo.status_vinculo, moradia: vinculo.moradia,
      admin_condominio: vinculo.admin_condominio, data_solicitacao: vinculo.data_solicitacao.toISOString(),
      data_aprovacao: vinculo.data_aprovacao?.toISOString() ?? null,
      data_inicio: vinculo.data_inicio?.toISOString() ?? null, data_fim: vinculo.data_fim?.toISOString() ?? null,
      condominio: { id_condominio: vinculo.condominio.id_condominio, nome_residencial: vinculo.condominio.nome_residencial },
      morador: { id_condomino: vinculo.condomino.id_condomino, nome_completo: vinculo.condomino.nome_completo },
    } };
  }, { isolationLevel: "ReadCommitted" });
}

export async function rejeitarVinculo(
  auth: ContextoAutenticado | undefined, idVinculo: string,
): Promise<ResultadoRejeicaoVinculo> {
  const escopo = obterEscopoAdministrativo(auth);
  return prisma.$transaction(async (tx) => {
    const alvo = await buscarPendenteAutorizado(tx, escopo, idVinculo);
    if (alvo.admin_condominio || alvo.data_aprovacao !== null || alvo.data_inicio !== null || alvo.data_fim !== null) {
      throw new ErroDominio("MEMBERSHIP_INCONSISTENT", 409, "Solicitação de vínculo inconsistente.");
    }
    // Outro ATIVO do condômino não impede rejeitar esta solicitação; somente o alvo é alterado.
    const atualizacao = await atualizarVinculoPendenteParaRejeitado(tx, alvo.id_vinculo, alvo.id_condominio, escopo.idUsuario);
    if (atualizacao.count !== 1) {
      throw new ErroDominio("MEMBERSHIP_NOT_PENDING", 409, "Vínculo não está pendente.");
    }
    await criarAuditoria(tx, {
      id_ator: escopo.idUsuario, acao: "REJECT_MEMBERSHIP", entidade: "vinculo_condominio",
      entidade_id: alvo.id_vinculo, id_condominio: alvo.id_condominio, created_at: new Date(),
      metadata: { status_anterior: "PENDENTE", status_novo: "REJEITADO" },
    });
    const vinculo = await buscarVinculoAposDecisao(tx, alvo.id_vinculo);
    return { dados: {
      id_vinculo: vinculo.id_vinculo, status_vinculo: vinculo.status_vinculo, moradia: vinculo.moradia,
      admin_condominio: vinculo.admin_condominio, data_solicitacao: vinculo.data_solicitacao.toISOString(),
      data_aprovacao: null, data_inicio: null, data_fim: null,
      condominio: { id_condominio: vinculo.condominio.id_condominio, nome_residencial: vinculo.condominio.nome_residencial },
      morador: { id_condomino: vinculo.condomino.id_condomino, nome_completo: vinculo.condomino.nome_completo },
    } };
  }, { isolationLevel: "ReadCommitted" });
}

export async function aprovarVinculo(
  auth: ContextoAutenticado | undefined, idVinculo: string,
): Promise<ResultadoAprovacaoVinculo> {
  const escopo = obterEscopoAdministrativo(auth);
  // ReadCommitted reavalia PENDENTE após esperar outra aprovação ou rejeição.
  return prisma.$transaction(async (tx) => {
    const alvo = await buscarPendenteAutorizado(tx, escopo, idVinculo);
    const instante = new Date();
    const outro = await buscarOutroVinculoAtivo(tx, alvo.id_condomino, alvo.id_vinculo);
    const antigo = outro ? await prepararTransferencia(tx, auth!, escopo, alvo, outro, instante) : null;
    let atualizacao;
    try {
      atualizacao = await atualizarVinculoPendenteParaAtivo(tx, alvo.id_vinculo, alvo.id_condominio, escopo.idUsuario, instante);
    } catch (erro: unknown) {
      // Mapear somente o conflito esperado desta atualização; erros da auditoria não passam por este catch.
      if (erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === "P2002"
        && identificadoresDaConstraint(erro).some((nome) => nome === "one_active_membership_per_user" || nome === "id_condomino")) {
        throw new ErroDominio("ACTIVE_MEMBERSHIP_ALREADY_EXISTS", 409, "Condômino já possui vínculo ativo.");
      }
      throw erro;
    }
    if (atualizacao.count !== 1) {
      throw new ErroDominio("MEMBERSHIP_NOT_PENDING", 409, "Vínculo não está pendente.");
    }

    await criarAuditoria(tx, {
      id_ator: escopo.idUsuario, acao: "APPROVE_MEMBERSHIP", entidade: "vinculo_condominio",
      entidade_id: alvo.id_vinculo, id_condominio: alvo.id_condominio, created_at: instante,
      metadata: {
        status_anterior: "PENDENTE", status_novo: "ATIVO",
        ...(antigo ? { transferencia: true, id_vinculo_antigo: antigo.id_vinculo, id_vinculo_novo: alvo.id_vinculo,
          status_antigo_anterior: "ATIVO", status_antigo_novo: "ENCERRADO" } : {}),
      },
    });
    const vinculo = await buscarVinculoAposDecisao(tx, alvo.id_vinculo);
    if (!vinculo.data_aprovacao || !vinculo.data_inicio) throw new Error("Inconsistência na aprovação do vínculo.");
    return { dados: {
      id_vinculo: vinculo.id_vinculo, status_vinculo: vinculo.status_vinculo, moradia: vinculo.moradia,
      admin_condominio: vinculo.admin_condominio,
      data_aprovacao: vinculo.data_aprovacao.toISOString(), data_inicio: vinculo.data_inicio.toISOString(),
      condominio: { id_condominio: vinculo.condominio.id_condominio, nome_residencial: vinculo.condominio.nome_residencial },
      morador: { id_condomino: vinculo.condomino.id_condomino, nome_completo: vinculo.condomino.nome_completo },
    } };
  }, { isolationLevel: "ReadCommitted" });
}

export async function listarVinculosPendentes(
  auth: ContextoAutenticado | undefined,
  filtros: ListarVinculosPendentesQuery,
): Promise<ListaVinculosPendentes> {
  const escopo = obterEscopoAdministrativo(auth);
  validarCondominioAdministrativo(escopo.idCondominio, filtros.id_condominio);
  const idCondominio = escopo.idCondominio ?? filtros.id_condominio;

  const { vinculos, total } = await buscarVinculosPendentes({
    id_condominio: idCondominio,
    busca: filtros.busca,
    limite: filtros.limite,
    deslocamento: (filtros.pagina - 1) * filtros.limite,
  });

  return {
    dados: vinculos.map((vinculo) => ({
      id_vinculo: vinculo.id_vinculo,
      status_vinculo: vinculo.status_vinculo,
      moradia: vinculo.moradia,
      data_solicitacao: vinculo.data_solicitacao.toISOString(),
      morador: { id_condomino: vinculo.condomino.id_condomino, nome_completo: vinculo.condomino.nome_completo },
      condominio: { id_condominio: vinculo.condominio.id_condominio, nome_residencial: vinculo.condominio.nome_residencial },
    })),
    paginacao: {
      pagina: filtros.pagina,
      limite: filtros.limite,
      total,
      total_paginas: Math.ceil(total / filtros.limite),
    },
  };
}

function representarVinculo(vinculo: VinculoConsultado | null): VinculoSituacaoResidencial | null {
  if (!vinculo) return null;
  return {
    id_vinculo: vinculo.id_vinculo,
    status_vinculo: vinculo.status_vinculo,
    moradia: vinculo.moradia,
    admin_condominio: vinculo.admin_condominio,
    data_solicitacao: vinculo.data_solicitacao.toISOString(),
    data_aprovacao: vinculo.data_aprovacao?.toISOString() ?? null,
    data_inicio: vinculo.data_inicio?.toISOString() ?? null,
    data_fim: vinculo.data_fim?.toISOString() ?? null,
    condominio: {
      id_condominio: vinculo.condominio.id_condominio,
      nome_residencial: vinculo.condominio.nome_residencial,
      cep: vinculo.condominio.cep,
      endereco: vinculo.condominio.endereco,
    },
  };
}

export async function consultarMinhaSituacaoResidencial(
  auth: ContextoAutenticado | undefined,
): Promise<SituacaoResidencial> {
  if (!auth) throw new ErroDominio("UNAUTHENTICATED", 401, "Autenticação necessária.");

  const { usuario, ativos, pendentes, historico } = await buscarSituacaoResidencialDoUsuario(auth.id_usuario);
  const resposta: SituacaoResidencial = {
    dados: {
      onboarding_realizado: false,
      super_admin: false,
      vinculo_ativo: null,
      solicitacao_pendente: null,
      ultimo_vinculo: null,
    },
  };
  if (!usuario) return resposta;
  resposta.dados.onboarding_realizado = true;
  if (usuario.super_admin) {
    resposta.dados.super_admin = true;
    return resposta;
  }
  if (!usuario.condomino || ativos.length > 1 || pendentes.length > 1) {
    throw new Error("Inconsistência no estado residencial.");
  }

  resposta.dados.vinculo_ativo = representarVinculo(ativos[0] ?? null);
  resposta.dados.solicitacao_pendente = representarVinculo(pendentes[0] ?? null);
  if (ativos.length === 0 && pendentes.length === 0) {
    resposta.dados.ultimo_vinculo = representarVinculo(historico);
  }
  return resposta;
}
