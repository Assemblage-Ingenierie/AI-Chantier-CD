import { orderZones } from './zoneGroups.js';

// Projet « vu depuis UNE visite » : ce que l'onglet Rapport (et l'export groupé) affiche pour
// cette visite. Source UNIQUE (VueProjet + export zip) → le zip est identique à l'aperçu.
export function buildVisitProjet(projet, visite) {
  return {
    ...projet,
    // Ordre canonique groupe → sous-zones (même tableau, inchangé, s'il n'y a aucun groupe).
    localisations:       orderZones(visite?.localisations ?? []),
    dateVisite:          visite?.dateVisite           ?? null,
    participants:        visite?.participants         ?? [],
    tableauRecap:        visite?.tableauRecap         ?? [],
    photosParLigne:      visite?.photosParLigne       ?? 2,
    plansEnFin:          visite?.plansEnFin           ?? false,
    plansNoBreak:        visite?.plansNoBreak         ?? false,
    rapportPageBreaks:   visite?.rapportPageBreaks    ?? [],
    includeTableauRecap: visite?.includeTableauRecap  !== false,
    includeConclusion:   visite?.includeConclusion    ?? false,
    conclusion:          visite?.conclusion           ?? '',
    conclusionAlign:     visite?.conclusionAlign      ?? 'left',
    annexes:             visite?.annexes              ?? [],
    visiteNom:           visite?.label                 ?? '',
    ingenieur:           visite?.ingenieur             ?? '',
  };
}
