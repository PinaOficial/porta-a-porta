import { supabase } from "../../lib/supabase";
export const authApi = {
  login: (email: string, senha: string) => supabase.auth.signInWithPassword({ email, password: senha }),
  cadastro: (email: string, senha: string) => supabase.auth.signUp({
    email, password: senha, options: { emailRedirectTo: `${window.location.origin}/` },
  }),
  logout: () => supabase.auth.signOut(),
};

export function mensagemErroAuth(erro: unknown) {
  const codigo = typeof erro === "object" && erro && "code" in erro ? erro.code : "";
  if (codigo === "invalid_credentials") return "E-mail ou senha incorretos.";
  if (codigo === "email_not_confirmed") return "Confirme seu e-mail antes de entrar.";
  if (codigo === "user_already_exists") return "Este e-mail já possui uma conta. Tente entrar.";
  if (codigo === "weak_password") return "A senha não atende à política de segurança. Escolha outra senha.";
  if (codigo === "over_email_send_rate_limit" || codigo === "over_request_rate_limit") return "Muitas tentativas. Aguarde um pouco e tente novamente.";
  return "Não foi possível conectar à sua conta. Verifique sua conexão e tente novamente.";
}
