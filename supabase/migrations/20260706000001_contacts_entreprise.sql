-- Ajoute l'ENTREPRISE aux intervenants du carnet (demande : afficher
-- Nom / Poste / Entreprise dans le carnet, la partie intervenants du
-- rapport et la page de garde).
ALTER TABLE aichantier_contacts ADD COLUMN IF NOT EXISTS entreprise text;
