import type { Prisma } from "../generated/prisma/client.js";

export function identificadoresDaConstraint(erro: Prisma.PrismaClientKnownRequestError): string[] {
  const target = erro.meta?.target;
  const identificadores = typeof target === "string" ? [target]
    : Array.isArray(target) ? target.filter((item): item is string => typeof item === "string") : [];
  // Prisma 7 com adapter-pg fornece o índice PostgreSQL na causa do erro do adapter.
  const adapter = erro.meta?.driverAdapterError;
  if (typeof adapter === "object" && adapter !== null && "cause" in adapter) {
    const causa = adapter.cause;
    if (typeof causa === "object" && causa !== null && "constraint" in causa) {
      const constraint = causa.constraint;
      if (typeof constraint === "object" && constraint !== null && "index" in constraint && typeof constraint.index === "string") {
        identificadores.push(constraint.index);
      }
    }
  }
  return identificadores;
}
