-- Ingénieurs au niveau du PROJET (initiales multiples « SV, TCM »), saisis à la
-- création/modification du projet — INDÉPENDANTS des ingénieurs de chaque visite.
-- Un projet est « à moi » (filtre « Mes projets » + hors-ligne automatique) si mes
-- initiales figurent sur le projet OU sur au moins une de ses visites.
ALTER TABLE aichantier_chantiers ADD COLUMN IF NOT EXISTS ingenieurs text;
