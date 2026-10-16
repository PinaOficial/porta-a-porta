import type { z } from "zod";
import type { onboardingSchema } from "./onboarding.schema";
export type Onboarding = z.infer<typeof onboardingSchema>;
export interface ResultadoOnboarding {
  id_usuario: string; nome_completo: string; id_vinculo: string;
  id_condominio: string; moradia: string; status_vinculo: "PENDENTE"; admin_condominio: false;
}
