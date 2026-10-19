-- =====================================================================
-- Tablero Virtual - Versión 0.3.0 (PNJ y tokens muertos)
-- Pegar completo en Supabase > SQL Editor > New query > Run
--
-- Es seguro volver a ejecutarlo: sirve para instalar desde cero y también
-- para actualizar una instalación 0.1.x o 0.2.x a 0.3.0 (no borra tus datos).
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- Tablas
-- ---------------------------------------------------------------------
create table if not exists public.boards (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references auth.users(id) on delete cascade,
  name        text not null default 'Tablero Jugador',
  access_code text not null default upper(encode(gen_random_bytes(3), 'hex')),
  active      boolean not null default false,
  created_at  timestamptz not null default now()
);

-- 0.2.0: el tablero pasa a llamarse "Tablero Jugador"
alter table public.boards alter column name set default 'Tablero Jugador';
update public.boards set name = 'Tablero Jugador' where name = 'Mi tablero';

-- Un tablero por administrador en esta versión
create unique index if not exists boards_owner_unico on public.boards(owner_id);

create table if not exists public.strokes (
  id         bigint generated always as identity primary key,
  board_id   uuid not null references public.boards(id) on delete cascade,
  data       jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists strokes_board_idx on public.strokes(board_id, id);

-- 0.2.0: jugadores y sus tokens.
-- El jugador no tiene cuenta: su navegador guarda un id y un secreto al azar.
-- Acá solo se guarda el hash del secreto, así que ni siquiera el director
-- puede ver el secreto de nadie.
-- Si ya existía una tabla "players" de otro intento (con columnas distintas),
-- se reemplaza: esta tabla es nueva en 0.2.0, no hay datos de 0.1 en ella.
do $$
begin
  if to_regclass('public.players') is not null
     and (select count(distinct column_name)
            from information_schema.columns
           where table_schema = 'public' and table_name = 'players'
             and column_name in ('id','board_id','secret_hash','name','avatar','x','y','visible','created_at')) < 9
  then
    drop table public.players cascade;
  end if;
end $$;

create table if not exists public.players (
  id          uuid primary key,
  board_id    uuid not null references public.boards(id) on delete cascade,
  secret_hash text not null,
  name        text not null,
  avatar      text,
  x           real not null default 800,
  y           real not null default 450,
  visible     boolean not null default true,
  created_at  timestamptz not null default now(),
  constraint players_name_len  check (char_length(name) between 1 and 24),
  constraint players_avatar_ok check (
    avatar is null
    or (avatar ~ '^data:image/jpeg;base64,[A-Za-z0-9+/=]+$' and char_length(avatar) <= 40000)
  ),
  constraint players_pos_ok    check (x between 0 and 1600 and y between 0 and 900)
);

create index if not exists players_board_idx on public.players(board_id, created_at);

-- 0.3.0: PNJ (personajes del director) y tokens muertos.
-- Un PNJ es una fila de "players" con is_npc = true y secret_hash vacío:
-- ningún secreto de jugador puede coincidir con un hash vacío, así que solo
-- el director (por las políticas RLS) puede moverlo o cambiarlo.
alter table public.players add column if not exists is_npc boolean not null default false;
alter table public.players add column if not exists dead   boolean not null default false;

-- ---------------------------------------------------------------------
-- Seguridad (RLS): solo el dueño toca las tablas directamente.
-- Los jugadores NO leen ni escriben las tablas: usan funciones que
-- validan el código de acceso y su secreto personal.
-- ---------------------------------------------------------------------
alter table public.boards  enable row level security;
alter table public.strokes enable row level security;
alter table public.players enable row level security;

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

drop policy if exists players_dueno on public.players;
create policy players_dueno on public.players
  for all
  using (exists (
    select 1 from public.boards b
    where b.id = players.board_id and b.owner_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.boards b
    where b.id = players.board_id and b.owner_id = auth.uid()
  ));

-- ---------------------------------------------------------------------
-- Funciones auxiliares (internas)
-- ---------------------------------------------------------------------
create or replace function public.player_hash(p_secret text)
returns text
language sql
immutable
as $$
  select encode(sha256(convert_to(coalesce(p_secret, ''), 'utf8')), 'hex')
$$;

-- Datos de un jugador que se pueden mostrar a los demás (sin el hash)
create or replace function public.player_json(p public.players)
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object(
    'id', p.id,
    'name', p.name,
    'avatar', p.avatar,
    'x', p.x,
    'y', p.y,
    'visible', p.visible,
    'dead', p.dead
  )
$$;

revoke all on function public.player_hash(text) from public;
revoke all on function public.player_json(public.players) from public;

-- ---------------------------------------------------------------------
-- Función para jugadores: valida el código y devuelve el dibujo y los
-- tokens actuales.
-- Estados: ok | not_found | bad_code | inactive
-- (se valida el código antes que el estado, así "inactive" implica
--  que el código era correcto)
-- Los tokens ocultos solo se devuelven a su dueño.
-- ---------------------------------------------------------------------
drop function if exists public.join_board(uuid, text);

create or replace function public.join_board(
  p_board  uuid,
  p_code   text,
  p_player uuid default null,
  p_secret text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.boards%rowtype;
  h text := public.player_hash(p_secret);
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
    ),
    'players', coalesce(
      (select jsonb_agg(public.player_json(p) order by p.created_at, p.id)
         from public.players p
        where p.board_id = b.id
          and (p.visible or (p.id = p_player and p.secret_hash = h))),
      '[]'::jsonb
    )
  );
end;
$$;

revoke all on function public.join_board(uuid, text, uuid, text) from public;
grant execute on function public.join_board(uuid, text, uuid, text) to anon, authenticated;

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

-- ---------------------------------------------------------------------
-- Función para jugadores: crear o editar su propio personaje (nombre y
-- avatar). La primera vez crea el token; después solo lo edita el dueño
-- del secreto.
--   p_avatar = null  -> no cambia el avatar
--   p_avatar = ''    -> quita el avatar
-- ---------------------------------------------------------------------
create or replace function public.save_player(
  p_board  uuid,
  p_code   text,
  p_player uuid,
  p_secret text,
  p_name   text,
  p_avatar text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  b      public.boards%rowtype;
  pl     public.players%rowtype;
  h      text := public.player_hash(p_secret);
  nombre text := left(trim(coalesce(p_name, '')), 24);
  n      int;
begin
  select * into b from public.boards where id = p_board;

  if not found
     or upper(trim(coalesce(p_code, ''))) <> b.access_code
     or not b.active then
    raise exception 'No autorizado';
  end if;

  if p_player is null or coalesce(length(p_secret), 0) < 16 then
    raise exception 'Datos incompletos';
  end if;

  if nombre = '' then
    raise exception 'Falta el nombre';
  end if;

  select * into pl from public.players where id = p_player;

  if found then
    if pl.board_id <> p_board or pl.secret_hash <> h then
      raise exception 'No autorizado';
    end if;

    update public.players
       set name   = nombre,
           avatar = case
                      when p_avatar is null then avatar
                      when p_avatar = '' then null
                      else p_avatar
                    end
     where id = p_player
    returning * into pl;
  else
    -- los PNJ no cuentan para el límite de jugadores
    select count(*) into n from public.players where board_id = p_board and not is_npc;

    if n >= 30 then
      raise exception 'El tablero está lleno';
    end if;

    insert into public.players (id, board_id, secret_hash, name, avatar, x, y)
    values (
      p_player, p_board, h, nombre, nullif(p_avatar, ''),
      100 + (n % 12) * 70,
      100 + ((n / 12) % 6) * 70
    )
    returning * into pl;
  end if;

  return public.player_json(pl);
end;
$$;

revoke all on function public.save_player(uuid, text, uuid, text, text, text) from public;
grant execute on function public.save_player(uuid, text, uuid, text, text, text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- Función para jugadores: mover u ocultar/mostrar SU token.
-- Los parámetros en null no se modifican.
-- ---------------------------------------------------------------------
create or replace function public.update_token(
  p_board   uuid,
  p_code    text,
  p_player  uuid,
  p_secret  text,
  p_x       real default null,
  p_y       real default null,
  p_visible boolean default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  b  public.boards%rowtype;
  pl public.players%rowtype;
begin
  select * into b from public.boards where id = p_board;

  if not found
     or upper(trim(coalesce(p_code, ''))) <> b.access_code
     or not b.active then
    raise exception 'No autorizado';
  end if;

  update public.players
     set x       = case when p_x is null then x else least(greatest(p_x, 0), 1600) end,
         y       = case when p_y is null then y else least(greatest(p_y, 0), 900) end,
         visible = coalesce(p_visible, visible)
   where id = p_player
     and board_id = p_board
     and secret_hash = public.player_hash(p_secret)
  returning * into pl;

  if not found then
    raise exception 'No autorizado';
  end if;

  return public.player_json(pl);
end;
$$;

revoke all on function public.update_token(uuid, text, uuid, text, real, real, boolean) from public;
grant execute on function public.update_token(uuid, text, uuid, text, real, real, boolean) to anon, authenticated;
