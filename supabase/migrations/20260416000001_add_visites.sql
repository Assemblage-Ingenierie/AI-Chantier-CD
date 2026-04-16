-- Add visites JSONB to chantiers (visit metadata without localisations)
ALTER TABLE chantiers ADD COLUMN IF NOT EXISTS visites jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Add visite_id to chantier_localisations (null = legacy → assigned to first visit on next save)
ALTER TABLE chantier_localisations ADD COLUMN IF NOT EXISTS visite_id text;
