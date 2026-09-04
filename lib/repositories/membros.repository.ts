import "server-only";
import { prisma } from "@/lib/db/prisma";
import { normalizeEmail } from "@/lib/email";

const memberInclude = { condominos: { select: { nome: true, email: true } }, apartamentos: { select: { id: true, numero: true, bloco: true, tipo_unidade: true } } } as const;

export function listarMembros(condominioId: string, includeInactive: boolean) {
  return prisma.condomino_apartamentos.findMany({ where: { condominio_id: condominioId, ...(includeInactive ? {} : { ativo: true }) }, include: memberInclude, orderBy: { criado_em: "desc" } });
}
export function buscarMembro(condominioId: string, id: string, includeInactive = false) {
  return prisma.condomino_apartamentos.findFirst({ where: { id, condominio_id: condominioId, ...(includeInactive ? {} : { ativo: true }) }, include: memberInclude });
}
export function buscarVinculoDoCondomino(condominioId: string, condominoId: string, vinculoId?: string) {
  return prisma.condomino_apartamentos.findFirst({ where: { id: vinculoId, condomino_id: condominoId, condominio_id: condominioId, ativo: true }, include: memberInclude });
}
export function buscarVinculoAtivoDoCondomino(condominioId: string, condominoId: string, vinculoId?: string) {
  return prisma.condomino_apartamentos.findFirst({ where: { ...(vinculoId ? { id: vinculoId } : {}), condomino_id: condominoId, condominio_id: condominioId, ativo: true, apartamentos: { ativo: true } }, select: { id: true } });
}
export async function criarMembro(condominioId: string, data: { nome: string; email: string; dataNascimento: Date; apartamentoId: string; tipoVinculo: "proprietario" | "inquilino" }) {
  return prisma.$transaction(async (tx) => {
    const apartamento = await tx.apartamentos.findFirst({ where: { id: data.apartamentoId, condominio_id: condominioId, ativo: true }, select: { id: true } });
    if (!apartamento) return null;
    const email = normalizeEmail(data.email);
    const existente = await tx.condominos.findFirst({ where: { email: { equals: email, mode: "insensitive" } }, select: { id: true } });
    const condominoId = existente?.id ?? (await tx.condominos.create({ data: { nome: data.nome, email, data_nascimento: data.dataNascimento } })).id;
    const duplicate = await tx.condomino_apartamentos.findFirst({ where: { condomino_id: condominoId, apartamento_id: data.apartamentoId }, select: { id: true } });
    if (duplicate) return "duplicate" as const;
    return tx.condomino_apartamentos.create({ data: { condomino_id: condominoId, apartamento_id: data.apartamentoId, condominio_id: condominioId, tipo_vinculo: data.tipoVinculo }, include: memberInclude });
  });
}
export async function atualizarMembro(condominioId: string, id: string, data: { apartamentoId?: string; tipoVinculo?: "proprietario" | "inquilino" }) {
  if (data.apartamentoId) {
    const apartamento = await prisma.apartamentos.findFirst({ where: { id: data.apartamentoId, condominio_id: condominioId, ativo: true }, select: { id: true } });
    if (!apartamento) return null;
  }
  return prisma.condomino_apartamentos.update({ where: { id_condominio_id: { id, condominio_id: condominioId } }, data: { ...(data.apartamentoId ? { apartamento_id: data.apartamentoId } : {}), ...(data.tipoVinculo ? { tipo_vinculo: data.tipoVinculo } : {}), atualizado_em: new Date() }, include: memberInclude });
}
export async function desativarMembro(condominioId: string, id: string) {
  return prisma.$transaction(async (tx) => {
    const pending = await tx.pedidos.findFirst({ where: { condominio_id: condominioId, status: { in: ["solicitado", "aceito"] }, OR: [{ comprador_vinculo_id: id }, { vendedor_vinculo_id: id }] }, select: { id: true } });
    if (pending) return false;
    await tx.condomino_apartamentos.update({ where: { id_condominio_id: { id, condominio_id: condominioId } }, data: { ativo: false, desvinculado_em: new Date(), atualizado_em: new Date() } });
    await tx.produtos.updateMany({ where: { condominio_id: condominioId, vendedor_vinculo_id: id, ativo: true }, data: { ativo: false, desativado_em: new Date(), atualizado_em: new Date() } });
    await tx.carrinho_itens.deleteMany({
      where: {
        condominio_id: condominioId,
        produtos: { vendedor_vinculo_id: id },
        carrinhos: { status: "aberto" },
      },
    });
    return true;
  });
}
