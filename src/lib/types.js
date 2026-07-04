// Typedefs JSDoc du modèle métier — documentation + vérification éditeur (checkJs) SANS
// migration TypeScript. Aucune exécution : ce fichier ne contient que des annotations.
// Référencés depuis storage.js / useProjets.js via `import('./types.js').Projet`.
//
// Le triplet planId / planBg / planData d'une localisation forme une unité indissociable
// (cf. CLAUDE.md) — reflété ici dans Localisation.

/**
 * @typedef {Object} Photo
 * @property {string} [id]            Id de ligne DB (côté remote)
 * @property {string} [_id]           Id de ligne stable côté client (upsert idempotent)
 * @property {string} [_uploadId]     Handle de la file d'upload différé
 * @property {string} name
 * @property {string|null} [data]     data URL (base64) OU URL signée pour affichage
 * @property {string|null} [storage_url] Chemin relatif dans le bucket `photos`
 * @property {string|null} [annotated]   Composite annoté (data URL ou URL signée)
 * @property {Array|null}  [annotations] Tracés d'annotation
 * @property {number|null} [annotW]
 * @property {number|null} [annotH]
 * @property {number|null} [annotSizeScale]
 * @property {number} [cropX]
 * @property {number} [cropY]
 * @property {number} [cropZoom]
 * @property {string} [orient]
 * @property {boolean} [_legacy]
 */

/**
 * @typedef {Object} Item
 * @property {string} id
 * @property {string} titre
 * @property {'rien'|'a_faire'|'fait'|string} suivi
 * @property {'basse'|'moyenne'|'haute'|string} urgence
 * @property {string} commentaire
 * @property {'left'|'center'|'right'|string} [commentaireAlign]
 * @property {Object|null} [planAnnotations]
 * @property {Array} [plans]
 * @property {Photo[]} photos
 * @property {boolean} [_photosHydrated]
 */

/**
 * @typedef {Object} ExtraPlan
 * @property {string} id
 * @property {string|null} planId
 * @property {string|null} [planBg]
 * @property {string|null} [planData]
 * @property {Object|null} [planAnnotations]
 * @property {boolean} [reportHidden]
 */

/**
 * @typedef {Object} Localisation
 * @property {string} id
 * @property {string} nom
 * @property {string|null} planId
 * @property {string|null} planBg
 * @property {string|null} planData
 * @property {Object|null} planAnnotations
 * @property {boolean} [planReportHidden]
 * @property {ExtraPlan[]} extraPlans
 * @property {Item[]} items
 */

/**
 * @typedef {Object} Visite
 * @property {string} id
 * @property {string} label
 * @property {string|null} [dateVisite]
 * @property {string} [ingenieur]
 * @property {Array} [participants]
 * @property {Array} [tableauRecap]
 * @property {number} [photosParLigne]
 * @property {boolean} [plansEnFin]
 * @property {Array} [rapportPageBreaks]
 * @property {boolean} [includeTableauRecap]
 * @property {boolean} [includeConclusion]
 * @property {string} [conclusion]
 * @property {string} [conclusionAlign]
 * @property {string} [updatedAt]   Horodatage de dernière modif locale de la visite (V2 sync)
 * @property {Localisation[]} localisations
 */

/**
 * @typedef {Object} PlanLib
 * @property {string} id
 * @property {string} nom
 * @property {string|null} [bg]    Vignette (data URL)
 * @property {string|null} [data]  Chemin Storage de l'image HD
 * @property {string|null} [hd]    Image HD en mémoire (session d'import)
 */

/**
 * @typedef {Object} Projet
 * @property {string} id
 * @property {string} nom
 * @property {'en_cours'|'archive'|string} statut
 * @property {string} [adresse]
 * @property {string} [maitreOuvrage]
 * @property {string|null} [photo]
 * @property {string} [updatedAt]
 * @property {PlanLib[]} planLibrary
 * @property {Visite[]} visites
 */

export {};
