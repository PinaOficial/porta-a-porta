"use client";

import { useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import type { PerfilDto } from "@/lib/dtos/perfil";

const roleLabels = {
  superadmin: "Superadmin",
  admin: "Administrador",
  member: "Morador",
};

export function ProfilePage() {
  const [profile, setProfile] = useState<PerfilDto>();
  const [name, setName] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ data: PerfilDto }>("/api/me/perfil")
      .then((response) => {
        setProfile(response.data);
        setName(response.data.morador?.nome ?? "");
        setBirthDate(response.data.morador?.dataNascimento ?? "");
      })
      .catch((reason: unknown) =>
        setMessage(
          reason instanceof Error ? reason.message : "Erro ao carregar perfil.",
        ),
      );
  }, []);

  if (!profile && !message) {
    return (
      <main className="mx-auto w-full max-w-5xl p-5 sm:p-8">
        <Skeleton className="h-10 w-56" />
        <Skeleton className="mt-7 h-64 w-full" />
      </main>
    );
  }

  if (!profile) {
    return <main className="p-8 text-sm text-destructive">{message}</main>;
  }

  const isAdministrative = profile.conta.papel !== "member";

  return (
    <main className="mx-auto w-full max-w-5xl p-5 sm:p-8">
      <h1 className="text-3xl font-semibold">Meu Perfil</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Consulte sua conta, seus acessos e seus dados pessoais.
      </p>

      <div className="mt-7 grid gap-5 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Conta</CardTitle>
            <CardDescription>Informações da sua conta na aplicação.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <div>
              <p className="text-muted-foreground">Email</p>
              <p className="font-medium">
                {profile.conta.email ?? "Email não disponível"}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge>{profile.conta.ativo ? "Conta ativa" : "Conta inativa"}</Badge>
              <Badge>{roleLabels[profile.conta.papel]}</Badge>
            </div>
            {isAdministrative ? (
              <div>
                <p className="text-muted-foreground">Acesso</p>
                <p className="font-medium">
                  {profile.conta.papel === "superadmin"
                    ? "Superadmin — acesso administrativo global"
                    : "Administrador de condomínio"}
                </p>
              </div>
            ) : null}
            {profile.conta.condominiosAdministrados.length ? (
              <div>
                <p className="mb-2 text-muted-foreground">Condomínios administrados</p>
                <div className="flex flex-wrap gap-2">
                  {profile.conta.condominiosAdministrados.map((condominio) => (
                    <Badge key={condominio.id}>{condominio.nome}</Badge>
                  ))}
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Dados pessoais de morador</CardTitle>
            <CardDescription>
              {profile.morador
                ? "Dados permitidos do seu perfil de morador."
                : "Nenhum perfil de morador vinculado a esta conta."}
            </CardDescription>
          </CardHeader>
          {profile.morador ? (
            <CardContent className="space-y-4">
              <div>
                <Label htmlFor="profile-name">Nome</Label>
                <Input
                  id="profile-name"
                  className="mt-2"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="profile-birth-date">Data de nascimento</Label>
                <Input
                  id="profile-birth-date"
                  type="date"
                  className="mt-2"
                  value={birthDate}
                  onChange={(event) => setBirthDate(event.target.value)}
                />
              </div>
              {message ? (
                <p className="text-sm" aria-live="polite">
                  {message}
                </p>
              ) : null}
              <Button
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  setMessage("");
                  try {
                    const response = await api<{ data: PerfilDto }>(
                      "/api/me/perfil",
                      {
                        method: "PATCH",
                        body: JSON.stringify({
                          nome: name,
                          dataNascimento: birthDate,
                        }),
                      },
                    );
                    setProfile(response.data);
                    setMessage("Alterações salvas.");
                  } catch (reason) {
                    setMessage(
                      reason instanceof Error ? reason.message : "Erro ao salvar.",
                    );
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {busy ? "Salvando..." : "Salvar alterações"}
              </Button>
            </CardContent>
          ) : (
            <CardContent>
              <div className="rounded-xl bg-muted p-4 text-sm text-muted-foreground">
                Isso é esperado para administradores que não também são moradores.
              </div>
            </CardContent>
          )}
        </Card>
      </div>

      {profile.morador ? (
        <Card className="mt-5">
          <CardHeader>
            <CardTitle>Meus vínculos</CardTitle>
            <CardDescription>Seus apartamentos ativos.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            {profile.morador.vinculos.length ? (
              profile.morador.vinculos.map((vinculo) => (
                <div
                  className="rounded-xl bg-muted p-4 text-sm"
                  key={vinculo.vinculoId}
                >
                  <strong>{vinculo.condominio.nome}</strong>
                  <p className="mt-1 text-muted-foreground">
                    Bloco {vinculo.apartamento.bloco}, apartamento{" "}
                    {vinculo.apartamento.numero} · {vinculo.tipoVinculo}
                  </p>
                </div>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">Nenhum vínculo ativo.</p>
            )}
          </CardContent>
        </Card>
      ) : null}
    </main>
  );
}
