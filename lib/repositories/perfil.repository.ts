import "server-only";
import { prisma } from "@/lib/db/prisma";

export function buscarPerfil(condominoId: string) {
  return prisma.condominos.findUnique({
    where: { id: condominoId },
    include: { condomino_apartamentos: { where: { ativo: true, apartamentos: { ativo: true, condominios: { ativo: true } } }, include: { apartamentos: { select: { id: true, numero: true, bloco: true, condominio_id: true, condominios: { select: { nome: true } } } } } } },
  });
}
export function atualizarPerfil(condominoId: string, data: { nome?: string; dataNascimento?: Date }) {
  return prisma.condominos.update({ where: { id: condominoId }, data: { ...(data.nome ? { nome: data.nome } : {}), ...(data.dataNascimento ? { data_nascimento: data.dataNascimento } : {}), atualizado_em: new Date() } });
}
