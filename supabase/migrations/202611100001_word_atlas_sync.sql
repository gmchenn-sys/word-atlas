-- Word Atlas: per-account snapshots with optimistic concurrency and durable write receipts.
create table if not exists public.word_atlas_progress (
  user_id uuid not null references auth.users(id) on delete cascade,
  dataset_id text not null check (char_length(dataset_id) between 1 and 100),
  revision bigint not null default 0,
  document jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, dataset_id)
);
create table if not exists public.word_atlas_sync_receipts (
  user_id uuid not null references auth.users(id) on delete cascade,
  dataset_id text not null,
  write_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (user_id, dataset_id, write_id)
);
alter table public.word_atlas_progress enable row level security;
alter table public.word_atlas_sync_receipts enable row level security;
drop policy if exists word_atlas_own_progress on public.word_atlas_progress;
create policy word_atlas_own_progress on public.word_atlas_progress
  for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists word_atlas_own_receipts on public.word_atlas_sync_receipts;
create policy word_atlas_own_receipts on public.word_atlas_sync_receipts
  for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
revoke all on public.word_atlas_progress, public.word_atlas_sync_receipts from anon;
grant select, insert, update, delete on public.word_atlas_progress, public.word_atlas_sync_receipts to authenticated;

create or replace function public.word_atlas_commit(
  p_dataset text, p_revision bigint, p_document jsonb, p_write_id uuid
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  current_row public.word_atlas_progress;
  uid uuid := auth.uid();
begin
  if uid is null then raise exception 'authentication_required'; end if;
  if p_dataset is null or char_length(p_dataset) not between 1 and 100
     or p_write_id is null or p_revision is null or p_revision < 0
     or p_document is null or octet_length(p_document::text) > 2097152
     or (p_document #>> '{progress,version}') is distinct from '2'
     or (p_document #>> '{progress,datasetId}') is distinct from p_dataset
     or jsonb_typeof(p_document #> '{progress,cards}') is distinct from 'object'
     or jsonb_typeof(p_document #> '{settings}') is distinct from 'object'
  then raise exception 'invalid_sync_document'; end if;
  insert into public.word_atlas_progress(user_id, dataset_id)
    values(uid, p_dataset) on conflict do nothing;
  select * into current_row from public.word_atlas_progress
    where user_id=uid and dataset_id=p_dataset for update;
  -- Retrying a request after a lost HTTP response must not reapply its counters.
  if exists(select 1 from public.word_atlas_sync_receipts
      where user_id=uid and dataset_id=p_dataset and write_id=p_write_id) then
    return jsonb_build_object('applied',true,'revision',current_row.revision,'document',current_row.document);
  end if;
  if current_row.revision <> p_revision then
    return jsonb_build_object('applied',false,'revision',current_row.revision,'document',current_row.document);
  end if;
  update public.word_atlas_progress set document=p_document,
    revision=revision+1, updated_at=now()
    where user_id=uid and dataset_id=p_dataset returning * into current_row;
  insert into public.word_atlas_sync_receipts(user_id,dataset_id,write_id) values(uid,p_dataset,p_write_id);
  return jsonb_build_object('applied',true,'revision',current_row.revision,'document',current_row.document);
end;
$$;
revoke all on function public.word_atlas_commit(text,bigint,jsonb,uuid) from public, anon;
grant execute on function public.word_atlas_commit(text,bigint,jsonb,uuid) to authenticated;
