// Suppression de l'option « Ajouter une conclusion » du rapport (demande Thomas 23/11) : la
// conclusion s'écrit désormais comme une observation. Les conclusions DÉJÀ rédigées ne sont
// jamais perdues : elles deviennent une zone « Conclusion » contenant une observation éditable,
// ajoutée à la fin de la visite.
//
// - Ids DÉTERMINISTES (dérivés de l'id de visite) : deux appareils qui convertissent la même
//   visite produisent la MÊME zone / observation → aucun doublon en base (upsert sur le même id).
// - Conclusion cochée → observation incluse au rapport ; texte présent mais case décochée →
//   observation en brouillon (le texte n'était pas imprimé, il ne l'est toujours pas).
// - Une fois convertie, la conclusion de la visite est vidée → la conversion ne se refait pas
//   (et une zone « Conclusion » supprimée ensuite ne revient pas).
import { stripMarkup } from './markup.jsx';

export const conclusionZoneId = (visiteId) => `concl-${visiteId}`;
export const conclusionItemId = (visiteId) => `concl-obs-${visiteId}`;

function hash(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

export function needsConclusionConversion(visite) {
  if (!visite?.id) return false;
  return !!stripMarkup(visite.conclusion || '').trim();
}

// Visite → visite convertie (nouvel objet), ou la même visite si rien à convertir.
export function convertConclusion(visite) {
  if (!needsConclusionConversion(visite)) return visite;
  const zoneId = conclusionZoneId(visite.id);
  const itemId = conclusionItemId(visite.id);
  const locs = visite.localisations || [];
  const zoneIdx = locs.findIndex(l => l.id === zoneId);
  const allItems = locs.flatMap(l => l.items || []);
  // Même texte déjà converti (autre appareil) → rien à ajouter, on vide seulement la conclusion.
  const sameText = allItems.some(i => String(i.id).startsWith(itemId) && i.commentaire === visite.conclusion);
  // Texte DIFFÉRENT alors qu'une conversion existe déjà → nouvelle observation (id dérivé du
  // texte, toujours déterministe) : aucun texte n'est jamais écrasé ni perdu.
  const taken = allItems.some(i => i.id === itemId);
  const item = {
    id: taken ? `${itemId}-${hash(visite.conclusion)}` : itemId,
    titre: 'Conclusion',
    commentaire: visite.conclusion,
    commentaireAlign: visite.conclusionAlign || 'left',
    suivi: 'rien',
    urgence: 'rien',
    statut: visite.includeConclusion ? 'rapport' : 'brouillon',
    planAnnotations: null,
    plans: [],
    photos: [],
    _photosHydrated: true,
  };
  let localisations = locs;
  if (!sameText) {
    if (zoneIdx >= 0) localisations = locs.map((l, i) => (i === zoneIdx ? { ...l, items: [...(l.items || []), item] } : l));
    else localisations = [...locs, { id: zoneId, nom: 'Conclusion', planId: null, planBg: null, planData: null, planAnnotations: null, extraPlans: [], items: [item] }];
  }
  return {
    ...visite,
    localisations,
    includeConclusion: false,
    conclusion: '',
  };
}
