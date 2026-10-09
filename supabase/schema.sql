-- Controle de equipamentos locados — rodar no SQL Editor do Supabase.
-- Roda no MESMO projeto do APP-CMR-GERAL: reaproveita public.is_platform_user() e
-- public.is_platform_admin() (security.sql) e o login do Supabase Auth + app_users.
-- Idempotente: pode rodar de novo depois de atualizações.

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

-- ─── Permissões ──────────────────────────────────────────────
-- Usuário da plataforma: vê tudo, cadastra, renova, agenda/confirma devolução e adiciona fotos.
-- Admin (app_users.role = 'admin'): além disso edita dados cadastrais, exclui e desfaz devolução.
alter table public.equip_locacoes enable row level security;
alter table public.equip_fotos    enable row level security;

drop policy if exists platform_access on public.equip_locacoes;
drop policy if exists equip_sel on public.equip_locacoes;
drop policy if exists equip_ins on public.equip_locacoes;
drop policy if exists equip_upd on public.equip_locacoes;
drop policy if exists equip_del on public.equip_locacoes;
create policy equip_sel on public.equip_locacoes for select to authenticated using ((select public.is_platform_user()));
create policy equip_ins on public.equip_locacoes for insert to authenticated with check ((select public.is_platform_user()));
create policy equip_upd on public.equip_locacoes for update to authenticated
  using ((select public.is_platform_user())) with check ((select public.is_platform_user()));
create policy equip_del on public.equip_locacoes for delete to authenticated using ((select public.is_platform_admin()));

-- O UPDATE é liberado para todos porque renovar/devolver são updates; este gatilho garante
-- que quem não é admin só mexe no ciclo (vencimento, renovações, status, datas de devolução).
create or replace function public.equip_protege_cadastro()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.atualizado_em := now();
  if public.is_platform_admin() then return new; end if;

  if (new.equipamento, new.descricao, new.quantidade, new.fornecedor, new.contato, new.obra,
      new.contrato, new.periodo, new.valor_unitario, new.frete, new.data_entrada, new.criado_em)
     is distinct from
     (old.equipamento, old.descricao, old.quantidade, old.fornecedor, old.contato, old.obra,
      old.contrato, old.periodo, old.valor_unitario, old.frete, old.data_entrada, old.criado_em) then
    raise exception 'Somente administradores podem editar os dados da locação.' using errcode = '42501';
  end if;
  -- Renovações só podem ser acrescentadas, nunca apagadas ou reescritas
  if not (old.renovacoes <@ new.renovacoes and jsonb_array_length(new.renovacoes) >= jsonb_array_length(old.renovacoes)) then
    raise exception 'Somente administradores podem alterar o histórico de renovações.' using errcode = '42501';
  end if;
  -- Vencimento só avança (via renovação)
  if new.data_fim < old.data_fim then
    raise exception 'Somente administradores podem antecipar o vencimento.' using errcode = '42501';
  end if;
  if old.status = 'devolvido' and new.status <> 'devolvido' then
    raise exception 'Somente administradores podem desfazer uma devolução.' using errcode = '42501';
  end if;
  return new;
end $$;

drop trigger if exists equip_protege_cadastro on public.equip_locacoes;
create trigger equip_protege_cadastro before update on public.equip_locacoes
  for each row execute function public.equip_protege_cadastro();

drop policy if exists platform_access on public.equip_fotos;
drop policy if exists equip_fotos_sel on public.equip_fotos;
drop policy if exists equip_fotos_ins on public.equip_fotos;
drop policy if exists equip_fotos_del on public.equip_fotos;
create policy equip_fotos_sel on public.equip_fotos for select to authenticated using ((select public.is_platform_user()));
create policy equip_fotos_ins on public.equip_fotos for insert to authenticated with check ((select public.is_platform_user()));
create policy equip_fotos_del on public.equip_fotos for delete to authenticated using ((select public.is_platform_admin()));

-- Bucket PRIVADO: fotos de recebimento/entrega são prova em disputa com a locadora,
-- então leitura só por URL assinada, não pública.
insert into storage.buckets (id, name, public)
values ('equip-fotos', 'equip-fotos', false)
on conflict (id) do nothing;

drop policy if exists equip_fotos_files on storage.objects;
drop policy if exists equip_fotos_files_sel on storage.objects;
drop policy if exists equip_fotos_files_ins on storage.objects;
drop policy if exists equip_fotos_files_del on storage.objects;
create policy equip_fotos_files_sel on storage.objects for select to authenticated
  using (bucket_id = 'equip-fotos' and (select public.is_platform_user()));
create policy equip_fotos_files_ins on storage.objects for insert to authenticated
  with check (bucket_id = 'equip-fotos' and (select public.is_platform_user()));
create policy equip_fotos_files_del on storage.objects for delete to authenticated
  using (bucket_id = 'equip-fotos' and (select public.is_platform_admin()));

-- ─── Push (avisos com o app fechado) ─────────────────────────
-- Uma linha por aparelho inscrito. O cron (/api/cron/alertas) lê com a service role.
create table if not exists public.equip_push_subs (
  endpoint     text primary key,
  p256dh       text not null,
  auth         text not null,
  email        text not null,
  alerta_dias  integer not null default 5 check (alerta_dias between 0 and 60),
  criado_em    timestamptz not null default now()
);

alter table public.equip_push_subs enable row level security;
drop policy if exists push_own on public.equip_push_subs;
create policy push_own on public.equip_push_subs for all to authenticated
  using ((select public.is_platform_user()) and lower(email) = lower(coalesce((select auth.jwt()) ->> 'email', '')))
  with check ((select public.is_platform_user()) and lower(email) = lower(coalesce((select auth.jwt()) ->> 'email', '')));
