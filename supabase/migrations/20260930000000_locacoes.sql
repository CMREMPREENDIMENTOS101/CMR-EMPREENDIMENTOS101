-- CMR Locações: controle de equipamentos locados em obra.
-- Migração ADITIVA: não altera nenhuma tabela existente. Reusa public.is_platform_user()
-- (usuário ativo em public.app_users) como regra de acesso e public.projects como obras.

create table if not exists public.locacoes (
  id                   uuid primary key default gen_random_uuid(),
  nome                 text not null check (length(trim(nome)) > 0),
  fornecedor           text,
  obra                 text,
  project_id           uuid references public.projects(id) on delete set null,
  periodo              text not null check (periodo in ('diaria', 'semanal', 'quinzenal', 'mensal')),
  cobranca             text not null default 'proporcional' check (cobranca in ('proporcional', 'cheio')),
  qtd                  integer not null default 1 check (qtd >= 1),
  entrada              date not null,
  fim                  date not null,
  valor                numeric(12, 2) not null default 0 check (valor >= 0),
  extras               numeric(12, 2) not null default 0,
  valor_manual         numeric(12, 2),
  codigo               text,
  obs                  text,
  status               text not null default 'ativo' check (status in ('ativo', 'devolvido')),
  devolucao            date,
  retirada             date,
  renovacoes           jsonb not null default '[]'::jsonb,
  criado_em            timestamptz not null default now(),
  criado_por           uuid default auth.uid(),
  criado_por_email     text default (auth.jwt() ->> 'email'),
  atualizado_em        timestamptz not null default now(),
  atualizado_por_email text default (auth.jwt() ->> 'email'),
  constraint locacoes_fim_apos_entrada check (fim >= entrada),
  constraint locacoes_devolucao_coerente check ((status = 'devolvido') = (devolucao is not null))
);

create index if not exists locacoes_status_fim_idx on public.locacoes (status, fim);
create index if not exists locacoes_project_idx on public.locacoes (project_id);

create table if not exists public.locacao_fotos (
  id           uuid primary key default gen_random_uuid(),
  locacao_id   uuid not null references public.locacoes(id) on delete cascade,
  tipo         text not null check (tipo in ('recebimento', 'entrega')),
  path         text not null unique,
  criado_em    timestamptz not null default now(),
  criado_por   uuid default auth.uid(),
  criado_por_email text default (auth.jwt() ->> 'email')
);
create index if not exists locacao_fotos_locacao_idx on public.locacao_fotos (locacao_id);

-- auditoria: quem/quando alterou por último
create or replace function public.locacoes_touch()
returns trigger language plpgsql set search_path = public as $$
begin
  new.atualizado_em := now();
  new.atualizado_por_email := coalesce(auth.jwt() ->> 'email', new.atualizado_por_email);
  return new;
end $$;

drop trigger if exists locacoes_touch on public.locacoes;
create trigger locacoes_touch before update on public.locacoes
  for each row execute function public.locacoes_touch();

-- RLS: mesmo critério do restante da plataforma
alter table public.locacoes enable row level security;
alter table public.locacao_fotos enable row level security;

drop policy if exists locacoes_platform_access on public.locacoes;
create policy locacoes_platform_access on public.locacoes
  for all to authenticated
  using ((select public.is_platform_user()))
  with check ((select public.is_platform_user()));

drop policy if exists locacao_fotos_platform_access on public.locacao_fotos;
create policy locacao_fotos_platform_access on public.locacao_fotos
  for all to authenticated
  using ((select public.is_platform_user()))
  with check ((select public.is_platform_user()));

-- Storage: bucket privado só para fotos das locações (JPEG até 5 MB)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('locacoes', 'locacoes', false, 5242880, array['image/jpeg'])
on conflict (id) do nothing;

drop policy if exists locacoes_fotos_select on storage.objects;
create policy locacoes_fotos_select on storage.objects
  for select to authenticated
  using (bucket_id = 'locacoes' and (select public.is_platform_user()));

drop policy if exists locacoes_fotos_insert on storage.objects;
create policy locacoes_fotos_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'locacoes' and (select public.is_platform_user()));

drop policy if exists locacoes_fotos_delete on storage.objects;
create policy locacoes_fotos_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'locacoes' and (select public.is_platform_user()));

-- Realtime: sincroniza as telas de todos os usuários
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'locacoes') then
    alter publication supabase_realtime add table public.locacoes;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'locacao_fotos') then
    alter publication supabase_realtime add table public.locacao_fotos;
  end if;
end $$;
