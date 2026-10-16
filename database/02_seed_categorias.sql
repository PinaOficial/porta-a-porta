-- Seed opcional de categorias iniciais.
-- Pode ser executado mais de uma vez.

insert into categoria_produto (nome)
values
  ('Alimentos e Bebidas'),
  ('Casa e Bazar'),
  ('Eletrônicos'),
  ('Moda e Acessórios'),
  ('Outros')
on conflict (nome) do nothing;
