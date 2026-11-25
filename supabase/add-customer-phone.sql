-- KANDY BEAUTY: add customer phone number to orders
alter table public.orders add column if not exists customer_phone text not null default '';

create or replace function public.place_kandy_order(
  p_customer_name text,
  p_customer_phone text,
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
  if length(trim(coalesce(p_customer_name,''))) = 0
     or length(trim(coalesce(p_customer_phone,''))) = 0
     or length(trim(coalesce(p_town,''))) = 0 then
    raise exception 'Name, phone number and town are required';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Your bag is empty';
  end if;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_qty := greatest(0, (v_item->>'quantity')::integer);
    select * into v_product from public.products
    where id = (v_item->>'product_id')::uuid and published = true for update;
    if not found then raise exception 'A product is no longer available'; end if;
    if v_qty < 1 or v_product.stock < v_qty then raise exception 'Not enough stock for %', v_product.name; end if;
    v_total := v_total + v_product.price * v_qty;
  end loop;

  insert into public.orders(customer_name,customer_phone,town,note,total)
  values(trim(p_customer_name),trim(p_customer_phone),trim(p_town),coalesce(p_note,''),v_total)
  returning id into v_order_id;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_qty := (v_item->>'quantity')::integer;
    select * into v_product from public.products
    where id = (v_item->>'product_id')::uuid and published = true for update;
    insert into public.order_items(order_id,product_id,product_name,shade,unit_price,quantity)
    values(v_order_id,v_product.id,v_product.name,v_product.shade,v_product.price,v_qty);
    update public.products set stock=stock-v_qty,updated_at=now() where id=v_product.id;
  end loop;
  return jsonb_build_object('order_id',v_order_id,'total',v_total);
end;
$$;

revoke all on function public.place_kandy_order(text,text,text,jsonb) from public;
revoke all on function public.place_kandy_order(text,text,text,text,jsonb) from public;
grant execute on function public.place_kandy_order(text,text,text,text,jsonb) to anon, authenticated;
