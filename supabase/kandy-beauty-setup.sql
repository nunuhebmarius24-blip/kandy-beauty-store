-- KANDY BEAUTY database setup
create extension if not exists pgcrypto;

create table if not exists public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create or replace function public.is_kandy_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.admin_users
    where user_id = auth.uid()
  );
$$;

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text not null default 'Gloss',
  price numeric(10,2) not null check (price >= 0),
  shade text not null default '',
  description text not null default '',
  image_url text,
  stock integer not null default 0 check (stock >= 0),
  tag text not null default '',
  published boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  customer_name text not null,
  town text not null,
  note text not null default '',
  total numeric(10,2) not null default 0,
  status text not null default 'new' check (status in ('new','confirmed','fulfilled','cancelled')),
  created_at timestamptz not null default now()
);

create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  product_name text not null,
  shade text not null default '',
  unit_price numeric(10,2) not null,
  quantity integer not null check (quantity > 0)
);

alter table public.admin_users enable row level security;
alter table public.products enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;

drop policy if exists "admins can view own admin record" on public.admin_users;
create policy "admins can view own admin record"
on public.admin_users for select to authenticated
using (user_id = auth.uid());

drop policy if exists "public can view published products" on public.products;
create policy "public can view published products"
on public.products for select to anon, authenticated
using (published = true or public.is_kandy_admin());

drop policy if exists "admins manage products" on public.products;
create policy "admins manage products"
on public.products for all to authenticated
using (public.is_kandy_admin())
with check (public.is_kandy_admin());

drop policy if exists "admins view orders" on public.orders;
create policy "admins view orders"
on public.orders for select to authenticated
using (public.is_kandy_admin());

drop policy if exists "admins update orders" on public.orders;
create policy "admins update orders"
on public.orders for update to authenticated
using (public.is_kandy_admin())
with check (public.is_kandy_admin());

drop policy if exists "admins view order items" on public.order_items;
create policy "admins view order items"
on public.order_items for select to authenticated
using (public.is_kandy_admin());

create or replace function public.place_kandy_order(
  p_customer_name text,
  p_town text,
  p_note text,
  p_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order_id uuid;
  v_total numeric(10,2) := 0;
  v_item jsonb;
  v_product public.products%rowtype;
  v_qty integer;
begin
  if length(trim(coalesce(p_customer_name,''))) = 0 or length(trim(coalesce(p_town,''))) = 0 then
    raise exception 'Name and town are required';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Your bag is empty';
  end if;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_qty := greatest(0, (v_item->>'quantity')::integer);
    select * into v_product
    from public.products
    where id = (v_item->>'product_id')::uuid and published = true
    for update;
    if not found then raise exception 'A product is no longer available'; end if;
    if v_qty < 1 or v_product.stock < v_qty then raise exception 'Not enough stock for %', v_product.name; end if;
    v_total := v_total + v_product.price * v_qty;
  end loop;

  insert into public.orders(customer_name,town,note,total)
  values(trim(p_customer_name),trim(p_town),coalesce(p_note,''),v_total)
  returning id into v_order_id;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_qty := (v_item->>'quantity')::integer;
    select * into v_product from public.products
    where id = (v_item->>'product_id')::uuid and published = true
    for update;
    insert into public.order_items(order_id,product_id,product_name,shade,unit_price,quantity)
    values(v_order_id,v_product.id,v_product.name,v_product.shade,v_product.price,v_qty);
    update public.products set stock = stock - v_qty, updated_at = now()
    where id = v_product.id;
  end loop;

  return jsonb_build_object('order_id',v_order_id,'total',v_total);
end;
$$;

revoke all on function public.place_kandy_order(text,text,text,jsonb) from public;
grant execute on function public.place_kandy_order(text,text,text,jsonb) to anon, authenticated;

insert into storage.buckets (id, name, public)
values ('product-images','product-images',true)
on conflict (id) do update set public = true;

drop policy if exists "public can view Kandy product images" on storage.objects;
create policy "public can view Kandy product images"
on storage.objects for select
using (bucket_id = 'product-images');

drop policy if exists "admins upload Kandy product images" on storage.objects;
create policy "admins upload Kandy product images"
on storage.objects for insert to authenticated
with check (bucket_id = 'product-images' and public.is_kandy_admin());

drop policy if exists "admins update Kandy product images" on storage.objects;
create policy "admins update Kandy product images"
on storage.objects for update to authenticated
using (bucket_id = 'product-images' and public.is_kandy_admin())
with check (bucket_id = 'product-images' and public.is_kandy_admin());

drop policy if exists "admins delete Kandy product images" on storage.objects;
create policy "admins delete Kandy product images"
on storage.objects for delete to authenticated
using (bucket_id = 'product-images' and public.is_kandy_admin());
