import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "../../lib/supabase";
import { authApi } from "./auth.api";

interface AuthContexto {
  sessao: Session | null;
  usuario: User | null;
  carregandoSessao: boolean;
  erroSessao: boolean;
  login: (email: string, senha: string) => Promise<void>;
  cadastro: (email: string, senha: string) => Promise<boolean>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}
const Contexto = createContext<AuthContexto | null>(null);
export function AuthProvider({ children }: { children: ReactNode }) {
  const [sessao, setSessao] = useState<Session | null>(null);
  const [carregandoSessao, setCarregando] = useState(true);
  const [erroSessao, setErro] = useState(false);
  useEffect(() => {
    let ativo = true;
    let cancelar = () => {};
    void (async () => {
      try {
        const { data, error } = await supabase.auth.getSession();
        if (!ativo) return;
        if (error) throw error;
        setSessao(data.session);
      } catch {
        if (ativo) setErro(true);
      } finally {
        if (ativo) {
          const { data } = supabase.auth.onAuthStateChange((_evento, novaSessao) => {
            // Callback síncrono: não aguardar APIs Auth dentro do lock do Supabase.
            setSessao(novaSessao);
            setErro(false);
          });
          cancelar = () => data.subscription.unsubscribe();
          setCarregando(false);
        }
      }
    })();
    return () => { ativo = false; cancelar(); };
  }, []);
  const login = useCallback(async (email: string, senha: string) => {
    const { data, error } = await authApi.login(email, senha);
    if (error) throw error;
    setSessao(data.session);
  }, []);
  const cadastro = useCallback(async (email: string, senha: string) => {
    const { data, error } = await authApi.cadastro(email, senha);
    if (error) throw error;
    setSessao(data.session);
    return Boolean(data.session);
  }, []);
  const logout = useCallback(async () => {
    const { error } = await authApi.logout();
    if (error) throw error;
    setSessao(null);
    setErro(false);
  }, []);
  const refresh = useCallback(async () => {
    setCarregando(true);
    try {
      const { data, error } = await supabase.auth.refreshSession();
      if (error) throw error;
      setSessao(data.session);
      setErro(false);
    } catch { setErro(true); }
    finally { setCarregando(false); }
  }, []);
  return <Contexto.Provider value={{ sessao, usuario: sessao?.user ?? null, carregandoSessao, erroSessao, login, cadastro, logout, refresh }}>{children}</Contexto.Provider>;
}
export function useAuth() {
  const contexto = useContext(Contexto);
  if (!contexto) throw new Error("AuthProvider ausente.");
  return contexto;
}
