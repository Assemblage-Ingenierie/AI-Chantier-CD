-- Alignement du commentaire d'observation (left | center | right | justify).
-- Stocké jusqu'ici uniquement en local (form.commentaireAlign) → perdu au rechargement
-- depuis Supabase car non persisté. Ajout d'une colonne dédiée, additive et sûre.
ALTER TABLE aichantier_localisation_items
  ADD COLUMN IF NOT EXISTS commentaire_align text NOT NULL DEFAULT 'left';
