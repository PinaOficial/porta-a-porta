import { apiFetch, type Objeto } from "../../lib/api";
import type { MeuUsuario } from "./perfil.types";
export const consultarMeuUsuario = (signal?: AbortSignal) => apiFetch<Objeto<MeuUsuario>>("/usuarios/me", { signal });
