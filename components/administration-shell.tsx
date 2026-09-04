"use client";

import {
  Building2,
  Home,
  LayoutDashboard,
  Menu,
  Users,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";

export type AdministrationCondominium = {
  id: string;
  nome: string;
  cidade: string | null;
  uf: string | null;
  role: "member" | "admin" | "superadmin";
};

type AdministrationSession = {
  user: { id: string; email: string | null; ativo: boolean };
  isSuperadmin: boolean;
  condominios: AdministrationCondominium[];
};

type AdministrationContextValue = AdministrationSession & {
  administrableCondominiums: AdministrationCondominium[];
};

const AdministrationContext = createContext<AdministrationContextValue | null>(null);

export function useAdministration() {
  const value = useContext(AdministrationContext);
  if (!value) throw new Error("Contexto de administração indisponível.");
  return value;
}

export function AdministrationShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [session, setSession] = useState<AdministrationSession>();
  const [error, setError] = useState("");
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    api<{ data: AdministrationSession }>("/api/auth/me")
      .then((response) => setSession(response.data))
      .catch((reason: { status?: number; message?: string }) => {
        if (reason.status === 401) router.replace("/login");
        else setError(reason.message ?? "Não foi possível validar seu acesso.");
      });
  }, [router]);

  const contextValue = useMemo<AdministrationContextValue | null>(() => {
    if (!session) return null;
    return {
      ...session,
      administrableCondominiums: session.condominios.filter(
        (condominio) => condominio.role !== "member",
      ),
    };
  }, [session]);

  if (!contextValue && !error) {
    return (
      <main className="p-8">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="mt-6 h-72 w-full" />
      </main>
    );
  }

  if (!contextValue) {
    return <main className="p-8 text-sm text-destructive">{error}</main>;
  }

  const canAdminister =
    contextValue.isSuperadmin || contextValue.administrableCondominiums.length > 0;
  if (!canAdminister) {
    return (
      <main className="grid min-h-screen place-items-center p-6">
        <Card className="max-w-md">
          <CardHeader>
            <CardTitle>Acesso administrativo indisponível</CardTitle>
            <CardDescription>
              Sua conta não administra nenhum condomínio.
            </CardDescription>
          </CardHeader>
        </Card>
      </main>
    );
  }

  const links = [
    { href: "/administracao", label: "Visão geral", icon: LayoutDashboard },
    {
      href: "/administracao/condominios",
      label: "Condomínios",
      icon: Building2,
    },
    { href: "/administracao/usuarios", label: "Usuários", icon: Users },
  ];
  const firstCondominium = contextValue.condominios[0];
  const sidebar = (
    <aside className="flex h-full w-64 flex-col bg-sidebar p-4">
      <Link href="/administracao" className="mb-8 text-lg font-bold text-primary">
        PORTA-A-PORTA
      </Link>
      <p className="mb-3 text-xs font-semibold uppercase text-muted-foreground">
        Administração
      </p>
      <Badge className="mb-5 w-fit">
        {contextValue.isSuperadmin ? "Superadmin" : "Administrador"}
      </Badge>
      <nav className="space-y-1">
        {links.map(({ href, label, icon: Icon }) => {
          const active =
            href === "/administracao" ? pathname === href : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              onClick={() => setMobileOpen(false)}
              className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium ${
                active
                  ? "bg-primary text-primary-foreground"
                  : "hover:bg-sidebar-accent"
              }`}
            >
              <Icon size={17} />
              {label}
            </Link>
          );
        })}
      </nav>
      <div className="mt-auto space-y-1">
        {firstCondominium ? (
          <Link
            href={`/condominios/${firstCondominium.id}/produtos`}
            className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm hover:bg-sidebar-accent"
          >
            <Home size={17} />
            Voltar à vitrine
          </Link>
        ) : null}
        <Link href="/me/perfil" className="block px-3 py-2 text-sm">
          Meu perfil
        </Link>
        <Button
          variant="ghost"
          className="w-full justify-start"
          onClick={async () => {
            await api("/api/auth/logout", { method: "POST" });
            router.replace("/login");
          }}
        >
          Sair
        </Button>
      </div>
    </aside>
  );

  return (
    <AdministrationContext.Provider value={contextValue}>
      <div className="min-h-screen bg-background">
        <div className="fixed inset-y-0 z-30 hidden md:block">{sidebar}</div>
        {mobileOpen ? (
          <div className="fixed inset-0 z-40 bg-black/25 md:hidden">
            <div className="h-full w-64">{sidebar}</div>
          </div>
        ) : null}
        <div className="md:pl-64">
          <header className="flex h-16 items-center justify-between border-b px-4 sm:px-8">
            <Button
              size="icon"
              variant="ghost"
              className="md:hidden"
              aria-label="Abrir menu"
              onClick={() => setMobileOpen((open) => !open)}
            >
              <Menu />
            </Button>
            <p className="text-sm font-medium">Área administrativa</p>
            <Link href="/me/perfil" className="text-sm">
              {contextValue.user.email?.split("@")[0] ?? "Meu perfil"}
            </Link>
          </header>
          {children}
        </div>
      </div>
    </AdministrationContext.Provider>
  );
}
