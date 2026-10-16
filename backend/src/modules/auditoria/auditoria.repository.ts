import type { Prisma } from "../../generated/prisma/client.js";

export function criarAuditoria(tx: Prisma.TransactionClient, dados: Prisma.auditoriaUncheckedCreateInput) {
  return tx.auditoria.create({ data: dados, select: { id_auditoria: true } });
}
