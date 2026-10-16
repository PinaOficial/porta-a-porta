import { apiFetch, type Objeto } from "../../lib/api";
import type { Onboarding, ResultadoOnboarding } from "./onboarding.types";
export const realizarOnboarding = (dados: Onboarding) => apiFetch<Objeto<ResultadoOnboarding>>("/onboarding", { method: "POST", json: dados });
