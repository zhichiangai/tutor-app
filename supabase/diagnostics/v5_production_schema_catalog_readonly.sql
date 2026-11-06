-- V5 release readiness: exact public V4 structural footprint, metadata ONLY.
-- Deliberately no SELECT from student, payment, auth data rows.
-- Safe on Production, and identically executable on disposable local PostgreSQL.
with wanted(schema_name, table_name) as (
 values
 ('public','workspaces'),
 ('public','workspace_members'),
 ('public','students'),
 ('public','student_guardians'),
 ('public','lesson_records'),
 ('public','payment_batches'),
 ('public','payment_batch_items')
), relations as (
 select w.schema_name,w.table_name,c.oid,c.relrowsecurity as rls
 from wanted w
 left join pg_namespace n on n.nspname=w.schema_name
 left join pg_class c on c.relnamespace=n.oid and c.relname=w.table_name
  and c.relkind in ('r','p')
)
select jsonb_agg(jsonb_build_object(
 'table',r.schema_name||'.'||r.table_name,
 'exists',r.oid is not null,
 'rls',coalesce(r.rls,false),
 'columns',coalesce((
  select jsonb_agg(jsonb_build_object(
   'name',a.attname,
   'type',pg_catalog.format_type(a.atttypid,a.atttypmod),
   'not_null',a.attnotnull,
   'has_default',ad.adbin is not null
  ) order by a.attname)
  from pg_attribute a left join pg_attrdef ad on ad.adrelid=a.attrelid and ad.adnum=a.attnum
  where a.attrelid=r.oid and a.attnum>0 and not a.attisdropped
 ),'[]'::jsonb),
 'constraint_names',coalesce((
  select jsonb_agg(co.conname order by co.conname)
  from pg_constraint co where co.conrelid=r.oid
 ),'[]'::jsonb),
 'policy_names',coalesce((
  select jsonb_agg(p.polname order by p.polname)
  from pg_policy p where p.polrelid=r.oid
 ),'[]'::jsonb),
 'trigger_names',coalesce((
  select jsonb_agg(t.tgname order by t.tgname)
  from pg_trigger t where t.tgrelid=r.oid and not t.tgisinternal
 ),'[]'::jsonb)
) order by r.schema_name,r.table_name) as catalog
from relations r;
