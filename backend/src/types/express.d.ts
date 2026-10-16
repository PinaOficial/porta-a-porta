import type { ContextoAutenticado } from "./auth.js";

declare global {
  namespace Express {
    interface Request {
      auth?: ContextoAutenticado;
    }
  }
}
