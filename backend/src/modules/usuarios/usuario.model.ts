import type { criarUsuarioDoOnboarding, criarCondominoDoOnboarding } from "./usuario.repository.js";
import type { criarVinculoPendenteDoOnboarding } from "../vinculos/vinculo.repository.js";
import type { usuario } from "../../generated/prisma/client.js";

export interface ResultadoStatusConta {
  dados: Pick<usuario, "id_usuario" | "status_conta">;
}

export interface MeuUsuario {
  dados: { id_usuario: string; nome_completo: string | null; onboarding_realizado: boolean; super_admin: boolean };
}

export interface ResultadoOnboarding {
  dados: Awaited<ReturnType<typeof criarUsuarioDoOnboarding>> &
    Awaited<ReturnType<typeof criarCondominoDoOnboarding>> &
    Awaited<ReturnType<typeof criarVinculoPendenteDoOnboarding>>;
}
