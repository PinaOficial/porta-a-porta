"use client";

import { Plus, Search } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useAdministration } from "@/components/administration-shell";
import { ConfirmAction } from "@/components/ui/alert-dialog";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import { createCondominioSchema } from "@/lib/validations/condominios";

export type AdministrationCondo = {
  id: string;
  nome: string;
  descricao: string | null;
  cep: string | null;
  logradouro: string | null;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  cidade: string | null;
  uf: string | null;
  ativo: boolean;
  role: "member" | "admin" | "superadmin";
};

const initialForm = {
  nome: "",
  descricao: "",
  cep: "",
  logradouro: "",
  numero: "",
  complemento: "",
  bairro: "",
  cidade: "",
  uf: "",
};

function nullable(value: string) {
  const normalized = value.trim();
  return normalized ? normalized : null;
}

function createPayload(form: typeof initialForm) {
  return {
    nome: form.nome,
    descricao: nullable(form.descricao),
    cep: nullable(form.cep),
    logradouro: nullable(form.logradouro),
    numero: nullable(form.numero),
    complemento: nullable(form.complemento),
    bairro: nullable(form.bairro),
    cidade: nullable(form.cidade),
    uf: nullable(form.uf),
  };
}

export function CondominiumsPage() {
  const { isSuperadmin } = useAdministration();
  const [condominiums, setCondominiums] = useState<AdministrationCondo[]>();
  const [search, setSearch] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState(initialForm);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await api<{ data: AdministrationCondo[] }>(
        `/api/condominios${isSuperadmin ? "?includeInactive=true" : ""}`,
      );
      setCondominiums(
        response.data.filter((condominio) => condominio.role !== "member"),
      );
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "Erro ao carregar condomínios.");
    }
  }, [isSuperadmin]);

  useEffect(() => {
    void Promise.resolve().then(load);
  }, [load]);

  const filtered = useMemo(() => {
    const normalized = search.trim().toLocaleLowerCase("pt-BR");
    return (condominiums ?? []).filter((condominio) => {
      const matchesStatus = showInactive || condominio.ativo;
      const matchesSearch =
        !normalized ||
        `${condominio.nome} ${condominio.cidade ?? ""} ${condominio.uf ?? ""}`
          .toLocaleLowerCase("pt-BR")
          .includes(normalized);
      return matchesStatus && matchesSearch;
    });
  }, [condominiums, search, showInactive]);

  return (
    <main className="mx-auto max-w-7xl p-5 sm:p-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm text-muted-foreground">Administração</p>
          <h1 className="text-3xl font-semibold">Condomínios</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {isSuperadmin
              ? "Gerencie todos os condomínios da plataforma."
              : "Configure somente os condomínios que você administra."}
          </p>
        </div>
        {isSuperadmin ? (
          <Button onClick={() => setShowCreate((visible) => !visible)}>
            <Plus />
            Novo condomínio
          </Button>
        ) : null}
      </div>

      {showCreate && isSuperadmin ? (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle>Criar condomínio</CardTitle>
            <CardDescription>
              Informe apenas os dados administrativos do condomínio.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form
              className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
              onSubmit={async (event) => {
                event.preventDefault();
                setMessage("");
                const parsed = createCondominioSchema.safeParse(createPayload(form));
                if (!parsed.success) {
                  setMessage(parsed.error.issues[0]?.message ?? "Dados inválidos.");
                  return;
                }
                setBusy(true);
                try {
                  await api("/api/condominios", {
                    method: "POST",
                    body: JSON.stringify(parsed.data),
                  });
                  setForm(initialForm);
                  setShowCreate(false);
                  setMessage("Condomínio criado com sucesso.");
                  await load();
                } catch (reason) {
                  setMessage(reason instanceof Error ? reason.message : "Erro ao criar condomínio.");
                } finally {
                  setBusy(false);
                }
              }}
            >
              <FormField
                id="condo-name"
                label="Nome"
                value={form.nome}
                required
                onChange={(value) => setForm((current) => ({ ...current, nome: value }))}
              />
              <FormField
                id="condo-cep"
                label="CEP"
                value={form.cep}
                onChange={(value) => setForm((current) => ({ ...current, cep: value }))}
              />
              <FormField
                id="condo-street"
                label="Logradouro"
                value={form.logradouro}
                onChange={(value) => setForm((current) => ({ ...current, logradouro: value }))}
              />
              <FormField
                id="condo-number"
                label="Número"
                value={form.numero}
                onChange={(value) => setForm((current) => ({ ...current, numero: value }))}
              />
              <FormField
                id="condo-complement"
                label="Complemento"
                value={form.complemento}
                onChange={(value) => setForm((current) => ({ ...current, complemento: value }))}
              />
              <FormField
                id="condo-neighborhood"
                label="Bairro"
                value={form.bairro}
                onChange={(value) => setForm((current) => ({ ...current, bairro: value }))}
              />
              <FormField
                id="condo-city"
                label="Cidade"
                value={form.cidade}
                onChange={(value) => setForm((current) => ({ ...current, cidade: value }))}
              />
              <FormField
                id="condo-state"
                label="UF"
                value={form.uf}
                maxLength={2}
                onChange={(value) => setForm((current) => ({ ...current, uf: value }))}
              />
              <div className="sm:col-span-2 lg:col-span-3">
                <Label htmlFor="condo-description">Descrição</Label>
                <Textarea
                  id="condo-description"
                  className="mt-2"
                  value={form.descricao}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, descricao: event.target.value }))
                  }
                />
              </div>
              <div className="flex gap-2 sm:col-span-2 lg:col-span-3">
                <Button type="submit" disabled={busy}>
                  {busy ? "Criando..." : "Criar condomínio"}
                </Button>
                <Button type="button" variant="outline" onClick={() => setShowCreate(false)}>
                  Cancelar
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      ) : null}

      <div className="mt-6 flex flex-wrap items-center gap-4">
        <div className="relative w-full max-w-md">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Buscar por nome, cidade ou UF"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        {isSuperadmin ? (
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={showInactive}
              onChange={(event) => setShowInactive(event.target.checked)}
            />
            Mostrar inativos
          </label>
        ) : null}
      </div>

      {message ? <p className="mt-4 text-sm" aria-live="polite">{message}</p> : null}

      {!condominiums ? (
        <Skeleton className="mt-6 h-72 w-full" />
      ) : (
        <Card className="mt-6 overflow-hidden">
          {filtered.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>Cidade/UF</TableHead>
                  <TableHead>CEP</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((condominio) => (
                  <TableRow key={condominio.id}>
                    <TableCell className="font-medium">{condominio.nome}</TableCell>
                    <TableCell>
                      {condominio.cidade ?? "—"}
                      {condominio.uf ? `/${condominio.uf}` : ""}
                    </TableCell>
                    <TableCell>{condominio.cep ?? "—"}</TableCell>
                    <TableCell>
                      <Badge>{condominio.ativo ? "Ativo" : "Inativo"}</Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-2">
                        <Button size="sm" variant="outline" render={<Link href={`/administracao/condominios/${condominio.id}`} />}>
                          {condominio.ativo ? "Configurar" : "Ver"}
                        </Button>
                        {condominio.ativo ? (
                          <Button size="sm" variant="ghost" render={<Link href={`/condominios/${condominio.id}/produtos`} />}>
                            Ver vitrine
                          </Button>
                        ) : null}
                        <Button size="sm" variant="ghost" render={<Link href={`/administracao/usuarios?condominioId=${condominio.id}`} />}>
                          Usuários
                        </Button>
                        {isSuperadmin && condominio.ativo ? (
                          <ConfirmAction
                            trigger="Desativar"
                            title="Desativar este condomínio?"
                            description="O condomínio será desativado. O histórico de moradores, produtos e pedidos será preservado."
                            onConfirm={async () => {
                              await api(`/api/condominios/${condominio.id}`, { method: "DELETE" });
                              setMessage("Condomínio desativado.");
                              await load();
                            }}
                          />
                        ) : null}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <CardContent className="py-16 text-center text-sm text-muted-foreground">
              Nenhum condomínio encontrado.
            </CardContent>
          )}
        </Card>
      )}
    </main>
  );
}

function FormField({
  id,
  label,
  value,
  onChange,
  required,
  maxLength,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  maxLength?: number;
}) {
  return (
    <div>
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        className="mt-2"
        value={value}
        required={required}
        maxLength={maxLength}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}
