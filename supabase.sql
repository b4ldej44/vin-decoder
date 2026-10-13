-- Общая база комплектаций для VIN-декодера (/vin).
--
-- Запустить один раз: Supabase -> SQL Editor -> New query -> вставить -> Run.
--
-- Кто-то узнал коды опций своей машины (у дилера, из отчёта, с наклейки) и
-- сохранил их — следующий, кто введёт этот VIN, видит комплектацию сразу.
-- Регистрация не нужна. Браузер не трогает таблицу напрямую: только две
-- функции ниже, и обе проверяют, что им передали.

create table if not exists public.vin_builds (
  vin         text not null check (vin ~ '^[A-HJ-NPR-Z0-9]{17}$'),
  brand       text not null check (brand in ('bmw', 'mb', 'audi')),
  codes       text[] not null check (cardinality(codes) between 3 and 400),
  -- Хэш адреса, с которого прислали: один голос с адреса на VIN и защита от
  -- потока мусора. Сам адрес не хранится.
  source      text not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (vin, source)
);

create index if not exists vin_builds_source_day on public.vin_builds (source, updated_at);

alter table public.vin_builds enable row level security;
revoke all on public.vin_builds from anon, authenticated;

-- Адрес клиента из заголовков запроса PostgREST, захэшированный.
create or replace function public.vin_build_source() returns text
language sql stable as $$
  select md5('vin-builds:' || coalesce(
    nullif(split_part(coalesce(
      (current_setting('request.headers', true)::json ->> 'x-forwarded-for'), ''), ',', 1), ''),
    current_setting('request.headers', true)::json ->> 'cf-connecting-ip',
    'unknown'))
$$;

-- Самый подтверждённый набор кодов для VIN: одинаковые наборы от разных
-- адресов складываются в подтверждения.
create or replace function public.vin_build_get(p_vin text)
returns table (brand text, codes text[], confirmations int, updated_at timestamptz)
language sql stable security definer set search_path = public as $$
  select b.brand, b.codes, count(*)::int, max(b.updated_at)
  from public.vin_builds b
  where b.vin = upper(p_vin)
  group by b.brand, b.codes
  order by count(*) desc, max(b.updated_at) desc
  limit 1
$$;

create or replace function public.vin_build_add(p_vin text, p_brand text, p_codes text[])
returns int
language plpgsql security definer set search_path = public as $$
declare
  v_vin    text := upper(coalesce(p_vin, ''));
  v_codes  text[];
  v_source text := public.vin_build_source();
begin
  if v_vin !~ '^[A-HJ-NPR-Z0-9]{17}$' then raise exception 'bad vin'; end if;
  if p_brand not in ('bmw', 'mb', 'audi') then raise exception 'bad brand'; end if;

  -- Нормализуем: верхний регистр, без повторов, по порядку — тогда одинаковые
  -- комплектации от разных людей совпадают и считаются подтверждениями.
  select array_agg(distinct upper(c) order by upper(c)) into v_codes
  from unnest(p_codes) c;
  if v_codes is null or cardinality(v_codes) < 3 or cardinality(v_codes) > 400 then
    raise exception 'need 3..400 codes';
  end if;
  if exists (select 1 from unnest(v_codes) c where c !~ '^[0-9A-Z]{3}$') then
    raise exception 'bad code';
  end if;

  if (select count(*) from public.vin_builds
      where source = v_source and updated_at > now() - interval '1 day') >= 50 then
    raise exception 'too many today';
  end if;

  insert into public.vin_builds (vin, brand, codes, source)
  values (v_vin, p_brand, v_codes, v_source)
  on conflict (vin, source) do update
    set brand = excluded.brand, codes = excluded.codes, updated_at = now();

  return cardinality(v_codes);
end $$;

revoke all on function public.vin_build_source() from public;
revoke all on function public.vin_build_get(text) from public;
revoke all on function public.vin_build_add(text, text, text[]) from public;
grant execute on function public.vin_build_get(text) to anon, authenticated;
grant execute on function public.vin_build_add(text, text, text[]) to anon, authenticated;
