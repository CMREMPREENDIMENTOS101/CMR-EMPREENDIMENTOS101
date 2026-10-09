-- Controle de equipamentos locados — rodar no SQL Editor do Supabase.
-- Pensado para o MESMO projeto do APP-CMR-GERAL: reaproveita public.is_platform_user()
-- (security.sql) e o login do Supabase Auth + app_users. Em projeto novo, crie essa função
-- antes ou troque o "using" das policies por (true) para qualquer usuário autenticado.

create table if not exists public.equip_locacoes (
  id                 uuid primary key default gen_random_uuid(),
  equipamento        text not null,
  descricao          text not null default '',
  quantidade         integer not null default 1 check (quantidade > 0),
  fornecedor         text not null default '',
  contato            text not null default '',
  obra               text not null default '',
  contrato           text not null default '',
  periodo            text not null default 'mensal'
                       check (periodo in ('diaria','semanal','quinzenal','mensal')),
  valor_unitario     numeric(14,2) not null default 0,
  frete              numeric(14,2) not null default 0,
  data_entrada       date not null,
  data_fim           date not null,
  renovacoes         jsonb not null default '[]'::jsonb,
  status             text not null default 'ativo'
                       check (status in ('ativo','devolucao_agendada','devolvido')),
  devolucao_prevista date,
  data_devolucao     date,
  observacoes        text not null default '',
  criado_em          timestamptz not null default now(),
  atualizado_em      timestamptz not null default now(),
  constraint equip_fim_apos_entrada check (data_fim >= data_entrada)
);

create index if not exists equip_locacoes_status_fim on public.equip_locacoes (status, data_fim);
create index if not exists equip_locacoes_obra on public.equip_locacoes (obra);

create table if not exists public.equip_fotos (
  id          uuid primary key default gen_random_uuid(),
  locacao_id  uuid not null references public.equip_locacoes(id) on delete cascade,
  tipo        text not null check (tipo in ('recebimento','entrega')),
  path        text not null,
  criado_em   timestamptz not null default now()
);

create index if not exists equip_fotos_locacao on public.equip_fotos (locacao_id);

-- RLS: só usuários da plataforma (mesma regra das demais tabelas após a fase 0)
alter table public.equip_locacoes enable row level security;
alter table public.equip_fotos    enable row level security;

drop policy if exists platform_access on public.equip_locacoes;
create policy platform_access on public.equip_locacoes for all to authenticated
  using ((select public.is_platform_user())) with check ((select public.is_platform_user()));

drop policy if exists platform_access on public.equip_fotos;
create policy platform_access on public.equip_fotos for all to authenticated
  using ((select public.is_platform_user())) with check ((select public.is_platform_user()));

-- Bucket PRIVADO: fotos de recebimento/entrega são prova em disputa com a locadora,
-- então leitura só por URL assinada, não pública.
insert into storage.buckets (id, name, public)
values ('equip-fotos', 'equip-fotos', false)
on conflict (id) do nothing;

drop policy if exists equip_fotos_files on storage.objects;
create policy equip_fotos_files on storage.objects for all to authenticated
  using (bucket_id = 'equip-fotos' and (select public.is_platform_user()))
  with check (bucket_id = 'equip-fotos' and (select public.is_platform_user()));
