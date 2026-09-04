"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { useAdministration } from "@/components/administration-shell";
import type { AdministrationCondo } from "@/components/administration/condominiums-page";
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
import { api, formatPrice } from "@/lib/api";
import { updateCondominioSchema } from "@/lib/validations/condominios";

type Apartment = {
  id: string;
  numero: string;
  bloco: string;
  tipoUnidade: "apartamento" | "casa";
  ativo: boolean;
};

type Product = {
  id: string;
  nome: string;
  descricao: string | null;
  preco: number;
  estoque: number;
  ativo: boolean;
  vendedor: { nome: string };
  categoria: { id: string; nome: string };
};

type CondoForm = {
  nome: string;
  descricao: string;
  cep: string;
  logradouro: string;
  numero: string;
  complemento: string;
  bairro: string;
  cidade: string;
  uf: string;
};

const emptyCondoForm: CondoForm = {
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

function toForm(condominio: AdministrationCondo): CondoForm {
  return {
    nome: condominio.nome,
    descricao: condominio.descricao ?? "",
    cep: condominio.cep ?? "",
    logradouro: condominio.logradouro ?? "",
    numero: condominio.numero ?? "",
    complemento: condominio.complemento ?? "",
    bairro: condominio.bairro ?? "",
    cidade: condominio.cidade ?? "",
    uf: condominio.uf ?? "",
  };
}

function nullable(value: string) {
  return value.trim() || null;
}

export function CondominiumDetailPage({ condominioId }: { condominioId: string }) {
  const { isSuperadmin } = useAdministration();
  const [condominium, setCondominium] = useState<AdministrationCondo>();
  const [form, setForm] = useState<CondoForm>(emptyCondoForm);
  const [apartments, setApartments] = useState<Apartment[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [apartmentForm, setApartmentForm] = useState({
    id: "",
    bloco: "",
    numero: "",
    tipoUnidade: "apartamento" as "apartamento" | "casa",
  });
  const [productForm, setProductForm] = useState({
    id: "",
    nome: "",
    descricao: "",
    preco: "",
    estoque: "",
  });
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const condoResponse = await api<{ data: AdministrationCondo }>(
        `/api/condominios/${condominioId}`,
      );
      setCondominium(condoResponse.data);
      setForm(toForm(condoResponse.data));
      if (!condoResponse.data.ativo) {
        setApartments([]);
        setProducts([]);
        return;
      }
      const [apartmentsResponse, productsResponse] = await Promise.all([
        api<{ data: Apartment[] }>(
          `/api/condominios/${condominioId}/apartamentos?includeInactive=true`,
        ),
        api<{ data: Product[] }>(
          `/api/condominios/${condominioId}/produtos?includeInactive=true&limit=100`,
        ),
      ]);
      setApartments(apartmentsResponse.data);
      setProducts(productsResponse.data);
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "Erro ao carregar condomínio.");
    }
  }, [condominioId]);

  useEffect(() => {
    void Promise.resolve().then(load);
  }, [load]);

  if (!condominium && !message) {
    return (
      <main className="mx-auto max-w-7xl p-5 sm:p-8">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="mt-6 h-80 w-full" />
      </main>
    );
  }

  if (!condominium) {
    return <main className="p-8 text-sm text-destructive">{message}</main>;
  }

  return (
    <main className="mx-auto max-w-7xl p-5 sm:p-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm text-muted-foreground">Administração · Condomínios</p>
          <h1 className="text-3xl font-semibold">{condominium.nome}</h1>
          <div className="mt-2 flex gap-2">
            <Badge>{condominium.ativo ? "Ativo" : "Inativo"}</Badge>
            <Badge>{isSuperadmin ? "Escopo global" : "Administrador local"}</Badge>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {condominium.ativo ? (
            <Button variant="outline" render={<Link href={`/condominios/${condominioId}/produtos`} />}>
              Ver vitrine
            </Button>
          ) : null}
          <Button variant="outline" render={<Link href={`/administracao/usuarios?condominioId=${condominioId}`} />}>
            Gerenciar usuários
          </Button>
          {isSuperadmin && condominium.ativo ? (
            <ConfirmAction
              trigger="Desativar condomínio"
              title="Desativar este condomínio?"
              description="O histórico de moradores, produtos e pedidos será preservado."
              onConfirm={async () => {
                await api(`/api/condominios/${condominioId}`, { method: "DELETE" });
                setMessage("Condomínio desativado.");
                await load();
              }}
            />
          ) : null}
        </div>
      </div>

      {message ? <p className="mt-4 text-sm" aria-live="polite">{message}</p> : null}

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Dados administrativos</CardTitle>
          <CardDescription>
            Superadmins e administradores locais podem alterar estes campos seguros.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
            onSubmit={async (event) => {
              event.preventDefault();
              const parsed = updateCondominioSchema.safeParse({
                nome: form.nome,
                descricao: nullable(form.descricao),
                cep: nullable(form.cep),
                logradouro: nullable(form.logradouro),
                numero: nullable(form.numero),
                complemento: nullable(form.complemento),
                bairro: nullable(form.bairro),
                cidade: nullable(form.cidade),
                uf: nullable(form.uf),
              });
              if (!parsed.success) {
                setMessage(parsed.error.issues[0]?.message ?? "Dados inválidos.");
                return;
              }
              setBusy(true);
              setMessage("");
              try {
                await api(`/api/condominios/${condominioId}`, {
                  method: "PATCH",
                  body: JSON.stringify(parsed.data),
                });
                setMessage("Dados do condomínio atualizados.");
                await load();
              } catch (reason) {
                setMessage(reason instanceof Error ? reason.message : "Erro ao atualizar.");
              } finally {
                setBusy(false);
              }
            }}
          >
            {(
              [
                ["nome", "Nome"],
                ["cep", "CEP"],
                ["logradouro", "Logradouro"],
                ["numero", "Número"],
                ["complemento", "Complemento"],
                ["bairro", "Bairro"],
                ["cidade", "Cidade"],
                ["uf", "UF"],
              ] as const
            ).map(([field, label]) => (
              <div key={field}>
                <Label htmlFor={`edit-${field}`}>{label}</Label>
                <Input
                  id={`edit-${field}`}
                  className="mt-2"
                  value={form[field]}
                  disabled={!condominium.ativo}
                  maxLength={field === "uf" ? 2 : undefined}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, [field]: event.target.value }))
                  }
                />
              </div>
            ))}
            <div className="sm:col-span-2 lg:col-span-3">
              <Label htmlFor="edit-description">Descrição</Label>
              <Textarea
                id="edit-description"
                className="mt-2"
                value={form.descricao}
                disabled={!condominium.ativo}
                onChange={(event) =>
                  setForm((current) => ({ ...current, descricao: event.target.value }))
                }
              />
            </div>
            <div className="sm:col-span-2 lg:col-span-3">
              <Button type="submit" disabled={busy || !condominium.ativo}>
                {busy ? "Salvando..." : "Salvar alterações"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Moradias</CardTitle>
          <CardDescription>Crie, altere e desative unidades deste condomínio.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {condominium.ativo ? (
            <form
              className="grid gap-3 sm:grid-cols-4"
              onSubmit={async (event) => {
                event.preventDefault();
                setBusy(true);
                setMessage("");
                try {
                  await api(
                    apartmentForm.id
                      ? `/api/condominios/${condominioId}/apartamentos/${apartmentForm.id}`
                      : `/api/condominios/${condominioId}/apartamentos`,
                    {
                      method: apartmentForm.id ? "PATCH" : "POST",
                      body: JSON.stringify({
                        bloco: apartmentForm.bloco,
                        numero: apartmentForm.numero,
                        tipoUnidade: apartmentForm.tipoUnidade,
                      }),
                    },
                  );
                  setApartmentForm({ id: "", bloco: "", numero: "", tipoUnidade: "apartamento" });
                  setMessage(apartmentForm.id ? "Moradia atualizada." : "Moradia criada.");
                  await load();
                } catch (reason) {
                  setMessage(reason instanceof Error ? reason.message : "Erro ao salvar moradia.");
                } finally {
                  setBusy(false);
                }
              }}
            >
              <Input
                aria-label="Bloco"
                placeholder="Bloco"
                required
                value={apartmentForm.bloco}
                onChange={(event) => setApartmentForm((current) => ({ ...current, bloco: event.target.value }))}
              />
              <Input
                aria-label="Número"
                placeholder="Número"
                required
                value={apartmentForm.numero}
                onChange={(event) => setApartmentForm((current) => ({ ...current, numero: event.target.value }))}
              />
              <select
                aria-label="Tipo de unidade"
                className="h-9 rounded-md border bg-background px-3 text-sm"
                value={apartmentForm.tipoUnidade}
                onChange={(event) =>
                  setApartmentForm((current) => ({
                    ...current,
                    tipoUnidade: event.target.value as "apartamento" | "casa",
                  }))
                }
              >
                <option value="apartamento">Apartamento</option>
                <option value="casa">Casa</option>
              </select>
              <div className="flex gap-2">
                <Button type="submit" disabled={busy}>
                  {apartmentForm.id ? "Atualizar" : "Adicionar"}
                </Button>
                {apartmentForm.id ? (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setApartmentForm({ id: "", bloco: "", numero: "", tipoUnidade: "apartamento" })}
                  >
                    Cancelar
                  </Button>
                ) : null}
              </div>
            </form>
          ) : null}
          {apartments.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Unidade</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {apartments.map((apartment) => (
                  <TableRow key={apartment.id}>
                    <TableCell>Bloco {apartment.bloco}, {apartment.numero}</TableCell>
                    <TableCell>{apartment.tipoUnidade === "casa" ? "Casa" : "Apartamento"}</TableCell>
                    <TableCell><Badge>{apartment.ativo ? "Ativa" : "Inativa"}</Badge></TableCell>
                    <TableCell>
                      <div className="flex gap-2">
                        {apartment.ativo ? (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setApartmentForm({
                              id: apartment.id,
                              bloco: apartment.bloco,
                              numero: apartment.numero,
                              tipoUnidade: apartment.tipoUnidade,
                            })}
                          >
                            Editar
                          </Button>
                        ) : null}
                        {apartment.ativo ? (
                          <ConfirmAction
                            trigger="Desativar"
                            title="Desativar esta moradia?"
                            description="A unidade só será desativada se não possuir vínculos ativos."
                            onConfirm={async () => {
                              await api(`/api/condominios/${condominioId}/apartamentos/${apartment.id}`, { method: "DELETE" });
                              setMessage("Moradia desativada.");
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
            <p className="text-sm text-muted-foreground">Nenhuma moradia encontrada.</p>
          )}
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Moderação de produtos</CardTitle>
          <CardDescription>
            Produtos deste condomínio, inclusive anúncios inativos.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {productForm.id ? (
            <form
              className="grid gap-3 rounded-xl bg-muted p-4 sm:grid-cols-2 lg:grid-cols-4"
              onSubmit={async (event) => {
                event.preventDefault();
                setBusy(true);
                setMessage("");
                try {
                  await api(`/api/condominios/${condominioId}/produtos/${productForm.id}`, {
                    method: "PATCH",
                    body: JSON.stringify({
                      nome: productForm.nome,
                      descricao: nullable(productForm.descricao),
                      preco: Number(productForm.preco),
                      estoque: Number(productForm.estoque),
                    }),
                  });
                  setProductForm({ id: "", nome: "", descricao: "", preco: "", estoque: "" });
                  setMessage("Produto atualizado.");
                  await load();
                } catch (reason) {
                  setMessage(reason instanceof Error ? reason.message : "Erro ao atualizar produto.");
                } finally {
                  setBusy(false);
                }
              }}
            >
              <Input required aria-label="Nome do produto" value={productForm.nome} onChange={(event) => setProductForm((current) => ({ ...current, nome: event.target.value }))} />
              <Input required type="number" min="0.01" step="0.01" aria-label="Preço" value={productForm.preco} onChange={(event) => setProductForm((current) => ({ ...current, preco: event.target.value }))} />
              <Input required type="number" min="0" step="1" aria-label="Estoque" value={productForm.estoque} onChange={(event) => setProductForm((current) => ({ ...current, estoque: event.target.value }))} />
              <div className="flex gap-2">
                <Button type="submit" disabled={busy}>Salvar</Button>
                <Button type="button" variant="outline" onClick={() => setProductForm({ id: "", nome: "", descricao: "", preco: "", estoque: "" })}>Cancelar</Button>
              </div>
              <Textarea className="sm:col-span-2 lg:col-span-4" aria-label="Descrição do produto" value={productForm.descricao} onChange={(event) => setProductForm((current) => ({ ...current, descricao: event.target.value }))} />
            </form>
          ) : null}
          {products.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Produto</TableHead>
                  <TableHead>Vendedor</TableHead>
                  <TableHead>Preço/estoque</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {products.map((product) => (
                  <TableRow key={product.id}>
                    <TableCell><strong>{product.nome}</strong><p className="text-xs text-muted-foreground">{product.categoria.nome}</p></TableCell>
                    <TableCell>{product.vendedor.nome}</TableCell>
                    <TableCell>{formatPrice(product.preco)} · {product.estoque}</TableCell>
                    <TableCell><Badge>{product.ativo ? "Ativo" : "Inativo"}</Badge></TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-2">
                        <Button size="sm" variant="ghost" render={<Link href={`/condominios/${condominioId}/produtos`} />}>Ver vitrine</Button>
                        {product.ativo ? (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setProductForm({
                              id: product.id,
                              nome: product.nome,
                              descricao: product.descricao ?? "",
                              preco: String(product.preco),
                              estoque: String(product.estoque),
                            })}
                          >
                            Editar
                          </Button>
                        ) : null}
                        {product.ativo ? (
                          <ConfirmAction
                            trigger="Desativar"
                            title="Desativar este produto?"
                            description="O anúncio sairá da vitrine, mas o histórico comercial será preservado."
                            onConfirm={async () => {
                              await api(`/api/condominios/${condominioId}/produtos/${product.id}`, { method: "DELETE" });
                              setMessage("Produto desativado.");
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
            <p className="text-sm text-muted-foreground">Nenhum produto encontrado.</p>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
