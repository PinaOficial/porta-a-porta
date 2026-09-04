import "server-only";
import { prisma } from "@/lib/db/prisma";

export function listarApartamentos(condominioId: string, includeInactive: boolean) {
  return prisma.apartamentos.findMany({ where: { condominio_id: condominioId, ...(includeInactive ? {} : { ativo: true }) }, orderBy: [{ bloco: "asc" }, { numero: "asc" }] });
}
export function buscarApartamento(condominioId: string, id: string, includeInactive = false) {
  return prisma.apartamentos.findFirst({ where: { id, condominio_id: condominioId, ...(includeInactive ? {} : { ativo: true }) } });
}
export function criarApartamento(condominioId: string, data: { numero: string; bloco: string }) {
  return prisma.apartamentos.create({ data: { condominio_id: condominioId, ...data } });
}
export function atualizarApartamento(condominioId: string, id: string, data: { numero?: string; bloco?: string }) {
  return prisma.apartamentos.update({ where: { id_condominio_id: { id, condominio_id: condominioId } }, data: { ...data, atualizado_em: new Date() } });
}
export async function desativarApartamento(condominioId: string, id: string) {
  const activeMembership = await prisma.condomino_apartamentos.findFirst({ where: { apartamento_id: id, condominio_id: condominioId, ativo: true }, select: { id: true } });
  if (activeMembership) return false;
  await prisma.apartamentos.update({ where: { id_condominio_id: { id, condominio_id: condominioId } }, data: { ativo: false, desativado_em: new Date(), atualizado_em: new Date() } });
  return true;
}
