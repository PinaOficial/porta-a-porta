import { z } from "zod";
import { uuidSchema } from "@/lib/validations/common";
export const createConviteAdminSchema = z.object({ email: z.email().trim().max(320), condominioId: uuidSchema }).strict();
