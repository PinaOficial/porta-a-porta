"use client";

import { Plus, Search, ShieldPlus, UserRound } from "lucide-react";
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
import { api } from "@/lib/api";
import type {
  AdministracaoUsuarioDto,
  ConviteAdminDto,
} from "@/lib/dtos/administracao";
import { createConviteAdminSchema } from "@/lib/validations/convites-admin";
import { createMembroSchema } from "@/lib/validations/membros";

type Apartment = {
  id: string;
  bloco: string;
  numero: string;
  ativo: boolean;
};

type UsersResponse = {
  usuarios: AdministracaoUsuarioDto[];
  convites: ConviteAdminDto[];
};

export function UsersPage({ initialCondominiumId }: { initialCondominiumId?: string }) {
  const {
    user,
    isSuperadmin,
    administrableCondominiums,
  } = useAdministration();
  const allowedInitial = administrableCondominiums.some(
    (condominio) => condominio.id === initialCondominiumId,
  )
    ? initialCondominiumId
    : undefined;
  const [selectedCondo, setSelectedCondo] = useState(
    allowedInitial ?? (isSuperadmin ? "" : administrableCondominiums[0]?.id ?? ""),
  );
  const [data, setData] = useState<UsersResponse>();
  const [search, setSearch] = useState("");
  const [message, setMessage] = useState("");
  const [showResidentForm, setShowResidentForm] = useState(false);
  const [showAdminForm, setShowAdminForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [residentCondo, setResidentCondo] = useState(
    allowedInitial ?? administrableCondominiums[0]?.id ?? "",
  );
  const [apartments, setApartments] = useState<Apartment[]>([]);
  const [membershipApartments, setMembershipApartments] = useState<Apartment[]>([]);
  const [membershipEdit, setMembershipEdit] = useState<{
    condominioId: string;
    vinculoId: string;
    apartamentoId: string;
    tipoVinculo: "proprietario" | "inquilino";
  }>();
  const [residentForm, setResidentForm] = useState({
    nome: "",
    email: "",
    dataNascimento: "",
    apartamentoId: "",
    tipoVinculo: "proprietario" as "proprietario" | "inquilino",
  });
  const [adminForm, setAdminForm] = useState({
    email: "",
    condominioId: allowedInitial ?? administrableCondominiums[0]?.id ?? "",
  });

  const load = useCallback(async () => {
    if (!isSuperadmin && !selectedCondo) return;
    setData(undefined);
    setMessage("");
    try {
      const query = new URLSearchParams({ includeInactive: "true" });
      if (selectedCondo) query.set("condominioId", selectedCondo);
      const response = await api<{ data: UsersResponse }>(
        `/api/administracao/usuarios?${query.toString()}`,
      );
      setData(response.data);
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "Erro ao carregar usuários.");
      setData({ usuarios: [], convites: [] });
    }
  }, [isSuperadmin, selectedCondo]);

  useEffect(() => {
    void Promise.resolve().then(load);
  }, [load]);

  useEffect(() => {
    if (!residentCondo) {
      return;
    }
    api<{ data: Apartment[] }>(
      `/api/condominios/${residentCondo}/apartamentos`,
    )
      .then((response) => setApartments(response.data.filter((item) => item.ativo)))
      .catch(() => setApartments([]));
  }, [residentCondo]);

  const filteredUsers = useMemo(() => {
    const normalized = search.trim().toLocaleLowerCase("pt-BR");
    return (data?.usuarios ?? []).filter((item) =>
      !normalized
        ? true
        : `${item.nome} ${item.email ?? ""}`
            .toLocaleLowerCase("pt-BR")
            .includes(normalized),
    );
  }, [data, search]);

  return (
    <main className="mx-auto max-w-7xl p-5 sm:p-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm text-muted-foreground">Administração</p>
          <h1 className="text-3xl font-semibold">Usuários</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {isSuperadmin
              ? "Gerencie contas públicas, moradores e administradores."
              : "Gerencie moradores e vínculos somente nos seus condomínios."}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setShowResidentForm((visible) => !visible)}>
            <Plus />
            Novo morador
          </Button>
          {isSuperadmin ? (
            <Button variant="outline" onClick={() => setShowAdminForm((visible) => !visible)}>
              <ShieldPlus />
              Novo administrador
            </Button>
          ) : null}
        </div>
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] sm:items-end">
        <div>
          <Label htmlFor="users-condominium">Condomínio</Label>
          <select
            id="users-condominium"
            className="mt-2 h-9 w-full rounded-md border bg-background px-3 text-sm"
            value={selectedCondo}
            onChange={(event) => {
              setSelectedCondo(event.target.value);
              if (event.target.value) setResidentCondo(event.target.value);
            }}
          >
            {isSuperadmin ? <option value="">Todos os condomínios</option> : null}
            {administrableCondominiums.map((condominio) => (
              <option key={condominio.id} value={condominio.id}>
                {condominiumLabel(condominio)}
              </option>
            ))}
          </select>
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Buscar por nome ou email"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
      </div>

      {showResidentForm ? (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle>Novo morador</CardTitle>
            <CardDescription>
              Faça o pré-cadastro por email. Nenhuma senha será criada.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form
              className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
              onSubmit={async (event) => {
                event.preventDefault();
                const parsed = createMembroSchema.safeParse(residentForm);
                if (!parsed.success) {
                  setMessage(parsed.error.issues[0]?.message ?? "Dados inválidos.");
                  return;
                }
                setBusy(true);
                setMessage("");
                try {
                  await api(`/api/condominios/${residentCondo}/membros`, {
                    method: "POST",
                    body: JSON.stringify(parsed.data),
                  });
                  setResidentForm({
                    nome: "",
                    email: "",
                    dataNascimento: "",
                    apartamentoId: "",
                    tipoVinculo: "proprietario",
                  });
                  setShowResidentForm(false);
                  setMessage("Morador pré-cadastrado com sucesso.");
                  if (!selectedCondo || selectedCondo === residentCondo) await load();
                } catch (reason) {
                  setMessage(reason instanceof Error ? reason.message : "Erro ao criar morador.");
                } finally {
                  setBusy(false);
                }
              }}
            >
              <div>
                <Label htmlFor="resident-condo">Condomínio</Label>
                <select
                  id="resident-condo"
                  required
                  className="mt-2 h-9 w-full rounded-md border bg-background px-3 text-sm"
                  value={residentCondo}
                  onChange={(event) => {
                    setResidentCondo(event.target.value);
                    setResidentForm((current) => ({ ...current, apartamentoId: "" }));
                  }}
                >
                  {administrableCondominiums.map((condominio) => (
                    <option key={condominio.id} value={condominio.id}>
                      {condominiumLabel(condominio)}
                    </option>
                  ))}
                </select>
              </div>
              <FormInput id="resident-name" label="Nome" value={residentForm.nome} onChange={(value) => setResidentForm((current) => ({ ...current, nome: value }))} />
              <FormInput id="resident-email" label="Email" type="email" value={residentForm.email} onChange={(value) => setResidentForm((current) => ({ ...current, email: value }))} />
              <FormInput id="resident-birth-date" label="Data de nascimento" type="date" value={residentForm.dataNascimento} onChange={(value) => setResidentForm((current) => ({ ...current, dataNascimento: value }))} />
              <div>
                <Label htmlFor="resident-apartment">Moradia</Label>
                <select
                  id="resident-apartment"
                  required
                  className="mt-2 h-9 w-full rounded-md border bg-background px-3 text-sm"
                  value={residentForm.apartamentoId}
                  onChange={(event) => setResidentForm((current) => ({ ...current, apartamentoId: event.target.value }))}
                >
                  <option value="">Selecione</option>
                  {apartments.map((apartment) => (
                    <option key={apartment.id} value={apartment.id}>
                      Bloco {apartment.bloco} · {apartment.numero}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <Label htmlFor="resident-kind">Tipo de vínculo</Label>
                <select
                  id="resident-kind"
                  className="mt-2 h-9 w-full rounded-md border bg-background px-3 text-sm"
                  value={residentForm.tipoVinculo}
                  onChange={(event) => setResidentForm((current) => ({ ...current, tipoVinculo: event.target.value as "proprietario" | "inquilino" }))}
                >
                  <option value="proprietario">Proprietário</option>
                  <option value="inquilino">Inquilino</option>
                </select>
              </div>
              <div className="flex gap-2 sm:col-span-2 lg:col-span-3">
                <Button type="submit" disabled={busy || !residentCondo || !apartments.length}>
                  {busy ? "Salvando..." : "Criar morador"}
                </Button>
                <Button type="button" variant="outline" onClick={() => setShowResidentForm(false)}>
                  Cancelar
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      ) : null}

      {showAdminForm && isSuperadmin ? (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle>Novo administrador</CardTitle>
            <CardDescription>
              Autorize o email para administrar um condomínio. Não há criação de senha.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form
              className="grid max-w-3xl gap-4 sm:grid-cols-2"
              onSubmit={async (event) => {
                event.preventDefault();
                const parsed = createConviteAdminSchema.safeParse(adminForm);
                if (!parsed.success) {
                  setMessage(parsed.error.issues[0]?.message ?? "Dados inválidos.");
                  return;
                }
                setBusy(true);
                setMessage("");
                try {
                  await api("/api/superadmin/administradores", {
                    method: "POST",
                    body: JSON.stringify(parsed.data),
                  });
                  setAdminForm((current) => ({ ...current, email: "" }));
                  setShowAdminForm(false);
                  setMessage("Autorização administrativa criada.");
                  await load();
                } catch (reason) {
                  setMessage(reason instanceof Error ? reason.message : "Erro ao criar administrador.");
                } finally {
                  setBusy(false);
                }
              }}
            >
              <FormInput id="admin-email" label="Email" type="email" value={adminForm.email} onChange={(value) => setAdminForm((current) => ({ ...current, email: value }))} />
              <div>
                <Label htmlFor="admin-condo">Condomínio</Label>
                <select
                  id="admin-condo"
                  required
                  className="mt-2 h-9 w-full rounded-md border bg-background px-3 text-sm"
                  value={adminForm.condominioId}
                  onChange={(event) => setAdminForm((current) => ({ ...current, condominioId: event.target.value }))}
                >
                  {administrableCondominiums.map((condominio) => (
                    <option key={condominio.id} value={condominio.id}>
                      {condominiumLabel(condominio)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex gap-2 sm:col-span-2">
                <Button type="submit" disabled={busy}>Criar autorização</Button>
                <Button type="button" variant="outline" onClick={() => setShowAdminForm(false)}>Cancelar</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      ) : null}

      {membershipEdit ? (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle>Alterar vínculo de morador</CardTitle>
            <CardDescription>
              Altere somente a moradia e o tipo de vínculo no condomínio selecionado.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form
              className="grid max-w-3xl gap-4 sm:grid-cols-2"
              onSubmit={async (event) => {
                event.preventDefault();
                setBusy(true);
                setMessage("");
                try {
                  await api(
                    `/api/condominios/${membershipEdit.condominioId}/membros/${membershipEdit.vinculoId}`,
                    {
                      method: "PATCH",
                      body: JSON.stringify({
                        apartamentoId: membershipEdit.apartamentoId,
                        tipoVinculo: membershipEdit.tipoVinculo,
                      }),
                    },
                  );
                  setMembershipEdit(undefined);
                  setMessage("Vínculo atualizado.");
                  await load();
                } catch (reason) {
                  setMessage(
                    reason instanceof Error ? reason.message : "Erro ao atualizar vínculo.",
                  );
                } finally {
                  setBusy(false);
                }
              }}
            >
              <div>
                <Label htmlFor="membership-apartment">Moradia</Label>
                <select
                  id="membership-apartment"
                  required
                  className="mt-2 h-9 w-full rounded-md border bg-background px-3 text-sm"
                  value={membershipEdit.apartamentoId}
                  onChange={(event) =>
                    setMembershipEdit((current) =>
                      current ? { ...current, apartamentoId: event.target.value } : current,
                    )
                  }
                >
                  {membershipApartments.map((apartment) => (
                    <option key={apartment.id} value={apartment.id}>
                      Bloco {apartment.bloco} · {apartment.numero}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <Label htmlFor="membership-kind">Tipo de vínculo</Label>
                <select
                  id="membership-kind"
                  className="mt-2 h-9 w-full rounded-md border bg-background px-3 text-sm"
                  value={membershipEdit.tipoVinculo}
                  onChange={(event) =>
                    setMembershipEdit((current) =>
                      current
                        ? {
                            ...current,
                            tipoVinculo: event.target.value as
                              | "proprietario"
                              | "inquilino",
                          }
                        : current,
                    )
                  }
                >
                  <option value="proprietario">Proprietário</option>
                  <option value="inquilino">Inquilino</option>
                </select>
              </div>
              <div className="flex gap-2 sm:col-span-2">
                <Button type="submit" disabled={busy || !membershipApartments.length}>
                  Salvar vínculo
                </Button>
                <Button type="button" variant="outline" onClick={() => setMembershipEdit(undefined)}>
                  Cancelar
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      ) : null}

      {message ? <p className="mt-4 text-sm" aria-live="polite">{message}</p> : null}

      {!data ? (
        <Skeleton className="mt-6 h-80 w-full" />
      ) : (
        <Card className="mt-6 overflow-hidden">
          {filteredUsers.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Usuário</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Vínculos</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredUsers.map((item) => (
                  <TableRow key={item.key}>
                    <TableCell>
                      <p className="font-medium">{item.nome}</p>
                      <p className="text-xs text-muted-foreground">{item.email ?? "Sem email"}</p>
                    </TableCell>
                    <TableCell><Badge>{userKind(item)}</Badge></TableCell>
                    <TableCell>
                      <div className="space-y-2">
                        {item.vinculos.map((vinculo) => (
                          <div key={vinculo.vinculoId} className="text-xs">
                            <p>{vinculo.condominio.nome} · Bloco {vinculo.apartamento.bloco}, {vinculo.apartamento.numero}</p>
                            <p className="text-muted-foreground">{vinculo.tipoVinculo} · {vinculo.ativo ? "ativo" : "inativo"}</p>
                          </div>
                        ))}
                        {item.administracoes.map((administracao) => (
                          <div key={administracao.administradorId} className="text-xs">
                            <p>Admin · {administracao.condominio.nome}</p>
                            <p className="text-muted-foreground">{administracao.ativo ? "ativo" : "revogado"}</p>
                          </div>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge>
                        {item.contaAtiva === null
                          ? "Pré-cadastro"
                          : item.contaAtiva
                            ? "Conta ativa"
                            : "Conta inativa"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex max-w-sm flex-wrap gap-2">
                        {item.vinculos.filter((vinculo) => vinculo.ativo).map((vinculo) => (
                          <div key={vinculo.vinculoId} className="flex gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={async () => {
                                try {
                                  const response = await api<{ data: Apartment[] }>(
                                    `/api/condominios/${vinculo.condominio.id}/apartamentos`,
                                  );
                                  setMembershipApartments(
                                    response.data.filter((apartment) => apartment.ativo),
                                  );
                                  setMembershipEdit({
                                    condominioId: vinculo.condominio.id,
                                    vinculoId: vinculo.vinculoId,
                                    apartamentoId: vinculo.apartamento.id,
                                    tipoVinculo: vinculo.tipoVinculo,
                                  });
                                } catch (reason) {
                                  setMessage(
                                    reason instanceof Error
                                      ? reason.message
                                      : "Erro ao carregar moradias.",
                                  );
                                }
                              }}
                            >
                              Editar vínculo
                            </Button>
                            <ConfirmAction
                              trigger="Desvincular"
                              title="Remover este morador do condomínio?"
                              description={`O vínculo com ${vinculo.condominio.nome} será desativado e o histórico será preservado.`}
                              onConfirm={async () => {
                                await api(`/api/condominios/${vinculo.condominio.id}/membros/${vinculo.vinculoId}`, { method: "DELETE" });
                                setMessage("Vínculo de morador desativado.");
                                await load();
                              }}
                            />
                          </div>
                        ))}
                        {isSuperadmin
                          ? item.administracoes.filter((admin) => admin.ativo).map((admin) => (
                              <ConfirmAction
                                key={admin.administradorId}
                                trigger="Revogar admin"
                                title="Revogar acesso administrativo?"
                                description={`O usuário deixará de administrar ${admin.condominio.nome}.`}
                                onConfirm={async () => {
                                  await api(`/api/superadmin/administradores/${admin.administradorId}`, { method: "DELETE" });
                                  setMessage("Acesso administrativo revogado.");
                                  await load();
                                }}
                              />
                            ))
                          : null}
                        {isSuperadmin && item.usuarioId && item.contaAtiva && item.usuarioId !== user.id ? (
                          <ConfirmAction
                            trigger="Desativar conta"
                            title="Desativar esta conta?"
                            description="O usuário perderá acesso à aplicação, mas seu histórico será preservado."
                            onConfirm={async () => {
                              await api(`/api/administracao/usuarios/${item.usuarioId}`, { method: "DELETE" });
                              setMessage("Conta desativada.");
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
            <CardContent className="flex min-h-48 flex-col items-center justify-center text-center">
              <UserRound className="mb-3 text-muted-foreground" />
              <CardTitle>Nenhum usuário encontrado</CardTitle>
              <CardDescription>Ajuste o condomínio ou a busca.</CardDescription>
            </CardContent>
          )}
        </Card>
      )}

      {isSuperadmin && data?.convites.length ? (
        <Card className="mt-6 overflow-hidden">
          <CardHeader>
            <CardTitle>Autorizações pendentes</CardTitle>
            <CardDescription>Emails que ainda não ativaram o acesso administrativo.</CardDescription>
          </CardHeader>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead>Condomínio</TableHead>
                <TableHead>Criada em</TableHead>
                <TableHead>Ação</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.convites.map((convite) => (
                <TableRow key={convite.id}>
                  <TableCell>{convite.email}</TableCell>
                  <TableCell>{convite.condominio.nome}</TableCell>
                  <TableCell>{new Date(convite.criadoEm).toLocaleDateString("pt-BR")}</TableCell>
                  <TableCell>
                    <ConfirmAction
                      trigger="Cancelar"
                      title="Cancelar esta autorização?"
                      description="O email deixará de estar pré-autorizado como administrador."
                      onConfirm={async () => {
                        await api(`/api/superadmin/administradores/convites/${convite.id}`, { method: "DELETE" });
                        setMessage("Autorização cancelada.");
                        await load();
                      }}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      ) : null}
    </main>
  );
}

function userKind(item: AdministracaoUsuarioDto) {
  if (item.isSuperadmin) return "Superadmin";
  const resident = item.vinculos.some((vinculo) => vinculo.ativo);
  const admin = item.administracoes.some((administration) => administration.ativo);
  if (resident && admin) return "Admin + Morador";
  if (admin) return "Admin";
  if (resident) return "Morador";
  return "Sem vínculo";
}

function condominiumLabel(condominio: {
  nome: string;
  cidade: string | null;
  uf: string | null;
}) {
  const location = [condominio.cidade, condominio.uf].filter(Boolean).join("/");
  return location ? `${condominio.nome} — ${location}` : condominio.nome;
}

function FormInput({
  id,
  label,
  value,
  onChange,
  type = "text",
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
}) {
  return (
    <div>
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type={type}
        className="mt-2"
        required
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}
