create table if not exists aichantier_contacts (
  id uuid primary key default gen_random_uuid(),
  nom text not null,
  poste text,
  email text,
  tel text,
  is_assemblage boolean not null default false,
  created_at timestamptz not null default now()
);

alter table aichantier_contacts enable row level security;

-- All authenticated users can read the shared directory
create policy "contacts_select" on aichantier_contacts
  for select to authenticated using (true);

-- All authenticated users can insert (add contacts)
create policy "contacts_insert" on aichantier_contacts
  for insert to authenticated with check (true);

-- All authenticated users can update contacts
create policy "contacts_update" on aichantier_contacts
  for update to authenticated using (true);

-- All authenticated users can delete contacts
create policy "contacts_delete" on aichantier_contacts
  for delete to authenticated using (true);
