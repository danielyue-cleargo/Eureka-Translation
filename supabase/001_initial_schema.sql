create table if not exists projects (
  id text primary key,
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists sources (
  id text primary key,
  project_id text not null references projects(id) on delete cascade,
  type text not null check (type in ('url', 'pdf', 'word')),
  url text,
  file_name text,
  openai_file_id text,
  vector_store_id text,
  created_at timestamptz not null default now()
);

create table if not exists terms (
  id text primary key,
  project_id text not null references projects(id) on delete cascade,
  canonical text not null,
  type text not null check (type in ('product_name', 'feature', 'feature_naming', 'specification', 'specification_title', 'accessory')),
  folder_id text not null check (folder_id in ('product_names', 'features', 'feature_naming', 'specifications', 'specification_titles', 'accessories')),
  translations jsonb not null default '{}'::jsonb,
  evidence jsonb not null default '[]'::jsonb,
  tags jsonb not null default '[]'::jsonb,
  confidence numeric not null default 0,
  status text not null check (status in ('draft', 'approved', 'rejected')),
  reviewer text,
  version integer not null default 1,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  synced_at timestamptz
);

alter table terms add column if not exists evidence jsonb not null default '[]'::jsonb;
alter table terms add column if not exists tags jsonb not null default '[]'::jsonb;
alter table terms add column if not exists version integer not null default 1;
alter table terms add column if not exists deleted_at timestamptz;
alter table terms add column if not exists synced_at timestamptz;

create table if not exists term_evidence (
  id text primary key,
  term_id text not null references terms(id) on delete cascade,
  source_id text not null references sources(id) on delete cascade,
  locale text check (locale in ('DE', 'FR', 'IT', 'ES')),
  url text,
  file_name text,
  page integer,
  snippet text not null
);

alter table term_evidence add column if not exists locale text check (locale in ('DE', 'FR', 'IT', 'ES'));

create table if not exists products (
  id text primary key,
  project_id text not null references projects(id) on delete cascade,
  product_name text not null,
  rrp numeric not null,
  discounted_price numeric not null,
  version integer not null default 1,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  synced_at timestamptz
);

alter table products add column if not exists version integer not null default 1;
alter table products add column if not exists deleted_at timestamptz;
alter table products add column if not exists synced_at timestamptz;

create table if not exists campaigns (
  id text primary key,
  project_id text not null references projects(id) on delete cascade,
  name text not null,
  version integer not null default 1,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  synced_at timestamptz
);

alter table campaigns add column if not exists version integer not null default 1;
alter table campaigns add column if not exists deleted_at timestamptz;
alter table campaigns add column if not exists synced_at timestamptz;

create table if not exists campaign_product_prices (
  id text primary key,
  project_id text not null references projects(id) on delete cascade,
  campaign_id text not null references campaigns(id) on delete cascade,
  product_id text not null references products(id) on delete cascade,
  discounted_price numeric not null,
  version integer not null default 1,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  synced_at timestamptz
);

alter table campaign_product_prices add column if not exists version integer not null default 1;
alter table campaign_product_prices add column if not exists deleted_at timestamptz;
alter table campaign_product_prices add column if not exists synced_at timestamptz;

create table if not exists figma_jobs (
  id text primary key,
  project_id text not null references projects(id) on delete cascade,
  status text not null check (status in ('draft', 'review_required', 'approved', 'applied')),
  source_frame jsonb not null,
  warnings jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  approved_at timestamptz,
  applied_at timestamptz
);

create table if not exists figma_text_nodes (
  id text primary key,
  job_id text not null references figma_jobs(id) on delete cascade,
  figma_node_id text not null,
  name text not null,
  source_text text not null,
  metadata jsonb not null default '{}'::jsonb
);

create table if not exists translations (
  id text primary key,
  job_id text not null references figma_jobs(id) on delete cascade,
  figma_node_id text not null,
  locale text not null check (locale in ('DE', 'FR', 'IT', 'ES')),
  source_text text not null,
  translated_text text not null,
  matched_term_ids text[] not null default '{}',
  confidence numeric not null default 0
);

create table if not exists warnings (
  id text primary key,
  job_id text not null references figma_jobs(id) on delete cascade,
  figma_node_id text,
  locale text check (locale in ('DE', 'FR', 'IT', 'ES')),
  type text not null,
  severity text not null check (severity in ('info', 'warning', 'error')),
  message text not null
);

create index if not exists sources_project_id_idx on sources(project_id);
create index if not exists terms_project_id_status_idx on terms(project_id, status);
create index if not exists terms_project_id_id_version_idx on terms(project_id, id, version);
create index if not exists terms_project_id_updated_at_idx on terms(project_id, updated_at);
create index if not exists terms_project_id_deleted_at_idx on terms(project_id, deleted_at);
create unique index if not exists products_project_id_product_name_key on products(project_id, lower(trim(product_name))) where deleted_at is null;
create index if not exists products_project_id_updated_at_idx on products(project_id, updated_at);
create index if not exists products_project_id_deleted_at_idx on products(project_id, deleted_at);
create index if not exists products_project_id_id_version_idx on products(project_id, id, version);
create unique index if not exists campaigns_project_id_name_key on campaigns(project_id, lower(trim(name))) where deleted_at is null;
create unique index if not exists campaign_product_prices_campaign_product_key on campaign_product_prices(campaign_id, product_id) where deleted_at is null;
create index if not exists campaigns_project_id_updated_at_idx on campaigns(project_id, updated_at);
create index if not exists campaign_product_prices_project_id_updated_at_idx on campaign_product_prices(project_id, updated_at);
create index if not exists campaign_product_prices_campaign_id_idx on campaign_product_prices(campaign_id);
create index if not exists campaign_product_prices_product_id_idx on campaign_product_prices(product_id);
create index if not exists figma_jobs_project_id_idx on figma_jobs(project_id);
create index if not exists translations_job_id_idx on translations(job_id);
