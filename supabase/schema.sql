-- =====================================================================
-- Tablero Virtual - Versión 1 (tablero en blanco)
-- Pegar completo en Supabase > SQL Editor > New query > Run
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- Tablas
-- ---------------------------------------------------------------------
create table if not exists public.boards (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references auth.users(id) on delete cascade,
  name        text not null default 'Mi tablero',
  access_code text not null default upper(encode(gen_random_bytes(3), 'hex')),
  active      boolean not null default false,
  created_at  timestamptz not null default now()
);

-- Un tablero por administrador en esta versión
create unique index if not exists boards_owner_unico on public.boards(owner_id);

create table if not exists public.strokes (
  id         bigint generated always as identity primary key,
  board_id   uuid not null references public.boards(id) on delete cascade,
  data       jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists strokes_board_idx on public.strokes(board_id, id);

-- ---------------------------------------------------------------------
-- Seguridad (RLS): solo el dueño toca las tablas directamente.
-- Los jugadores NO leen las tablas: usan la función join_board().
-- ---------------------------------------------------------------------
alter table public.boards  enable row level security;
alter table public.strokes enable row level security;

drop policy if exists boards_dueno on public.boards;
create policy boards_dueno on public.boards
  for all
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

drop policy if exists strokes_dueno on public.strokes;
create policy strokes_dueno on public.strokes
  for all
  using (exists (
    select 1 from public.boards b
    where b.id = strokes.board_id and b.owner_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.boards b
    where b.id = strokes.board_id and b.owner_id = auth.uid()
  ));

-- ---------------------------------------------------------------------
-- Función para jugadores: valida el código y devuelve el dibujo actual
-- Estados: ok | not_found | bad_code | inactive
-- (se valida el código antes que el estado, así "inactive" implica
--  que el código era correcto)
-- ---------------------------------------------------------------------
create or replace function public.join_board(p_board uuid, p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.boards%rowtype;
begin
  select * into b from public.boards where id = p_board;

  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;

  if upper(trim(coalesce(p_code, ''))) <> b.access_code then
    return jsonb_build_object('status', 'bad_code');
  end if;

  if not b.active then
    return jsonb_build_object('status', 'inactive');
  end if;

  return jsonb_build_object(
    'status', 'ok',
    'name', b.name,
    'strokes', coalesce(
      (select jsonb_agg(s.data order by s.id) from public.strokes s where s.board_id = b.id),
      '[]'::jsonb
    )
  );
end;
$$;

revoke all on function public.join_board(uuid, text) from public;
grant execute on function public.join_board(uuid, text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- Función para el administrador: renovar el código de acceso
-- ---------------------------------------------------------------------
create or replace function public.renew_code(p_board uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  nuevo text;
begin
  nuevo := upper(encode(gen_random_bytes(3), 'hex'));

  update public.boards
     set access_code = nuevo
   where id = p_board and owner_id = auth.uid();

  if not found then
    raise exception 'No autorizado';
  end if;

  return nuevo;
end;
$$;

revoke all on function public.renew_code(uuid) from public;
grant execute on function public.renew_code(uuid) to authenticated;
