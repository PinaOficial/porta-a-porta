import { z } from "zod";

const passwordSchema = z
  .string()
  .min(8, "A senha deve possuir no mínimo 8 caracteres.")
  .regex(/[a-z]/, "A senha deve possuir pelo menos 1 letra minúscula.")
  .regex(/[A-Z]/, "A senha deve possuir pelo menos 1 letra maiúscula.")
  .regex(/[0-9]/, "A senha deve possuir pelo menos 1 número.")
  .regex(
    /[^A-Za-z0-9]/,
    "A senha deve possuir pelo menos 1 caractere especial.",
  );

export const registerSchema = z
  .object({
    email: z.email("Email inválido.").trim(),
    password: passwordSchema,
  })
  .strict();

export const loginSchema = z
  .object({
    email: z.email("Email inválido.").trim(),
    password: z.string().min(1, "Senha obrigatória."),
  })
  .strict();
