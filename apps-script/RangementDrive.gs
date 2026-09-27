/**
 * Rangement Drive — lecture de Drive. Introduit en v0.1.
 *
 * Ce fichier ne lit que des **métadonnées** : nom, type, dossier parent,
 * propriétaire, dates, partages. Le contenu d'un fichier n'est jamais ouvert.
 * Il n'écrit rien : les écritures vivent dans RangementPlan.gs, et le banc
 * vérifie qu'elles n'existent nulle part ailleurs.
 */

/**
 * Les champs demandés, et pas un de plus : chaque champ grossit chaque page, et
 * un balayage en compte des dizaines.
 *
 * `permissions` n'est rendu par Google que pour les éléments que l'utilisateur
 * peut partager. Son absence veut donc dire « non mesuré », jamais « partagé
 * avec personne » — d'où `null` et non `[]` dans l'enregistrement.
 */
const RANGEMENT_CHAMPS_FICHIERS_ = 'nextPageToken, files(id,name,mimeType,parents,ownedByMe,'
  + 'owners(emailAddress),createdTime,modifiedTime,viewedByMeTime,quotaBytesUsed,shared,'
  + 'lastModifyingUser(emailAddress,me),shortcutDetails(targetId),'
  + 'permissions(type,role,emailAddress,domain,deleted))';

/** Le plafond documenté de `files.list` ; au-delà, Google ramène à 1 000. */
const RANGEMENT_TAILLE_PAGE_ = 1000;

/** Temps accordé à la lecture des membres des Drives partagés, sous le plafond. */
const RANGEMENT_BUDGET_DRIVES_MS_ = 90 * 1000;

const RANGEMENT_PROPRIETE_DOMAINES_ = 'RANGEMENT_DOMAINES_INTERNES';

const RANGEMENT_MIME_DOSSIER_ = 'application/vnd.google-apps.folder';

/**
 * Familles de types, pour l'affichage et les rapprochements. Une table plutôt
 * qu'une cascade de `if` : c'est une donnée, elle se relit comme telle.
 */
const RANGEMENT_GENRES_ = [
  ['application/vnd.google-apps.folder', 'dossier'],
  ['application/vnd.google-apps.shortcut', 'raccourci'],
  ['application/vnd.google-apps.document', 'document'],
  ['application/vnd.google-apps.spreadsheet', 'tableur'],
  ['application/vnd.google-apps.presentation', 'presentation'],
  ['application/vnd.google-apps.form', 'formulaire'],
  ['application/pdf', 'pdf'],
  ['image/', 'image'],
  ['video/', 'video'],
  ['audio/', 'audio'],
  ['application/zip', 'archive'],
  ['application/x-zip', 'archive'],
  ['application/vnd.openxmlformats-officedocument.wordprocessingml', 'document'],
  ['application/msword', 'document'],
  ['application/vnd.openxmlformats-officedocument.spreadsheetml', 'tableur'],
  ['application/vnd.ms-excel', 'tableur'],
  ['text/csv', 'tableur'],
  ['application/vnd.openxmlformats-officedocument.presentationml', 'presentation'],
  ['application/vnd.ms-powerpoint', 'presentation'],
];

const rangementGenre_ = (mime) => {
  const type = String(mime ?? '');
  const trouve = RANGEMENT_GENRES_.find(([prefixe]) => type.startsWith(prefixe));
  return trouve ? trouve[1] : 'autre';
};

const rangementAppel_ = (operation) => SocleReprises.avecReprises(operation, { tentatives: 5 });

const rangementNormaliserDomaines_ = (liste) => [...new Set(
  String(liste ?? '').split(/[\s,;]+/)
    .map((d) => d.trim().replace(/^@/, '').toLowerCase())
    .filter((d) => /^[a-z0-9.-]+\.[a-z]{2,}$/.test(d)))];

const rangementDomaineDe_ = (adresse) => {
  const texte = String(adresse ?? '').toLowerCase();
  const arobase = texte.lastIndexOf('@');
  return arobase === -1 ? '' : texte.slice(arobase + 1);
};

/**
 * Domaines internes : celui de l'utilisateur, plus ceux que l'administrateur a
 * déclarés. Une propriété illisible n'arrête pas l'analyse, mais elle est
 * comptée : la classification interne/externe en dépend, et le rapport doit
 * pouvoir le dire.
 */
const rangementDomainesInternes_ = (adresse) => {
  const declares = SocleErreurs.absorber('domaines internes illisibles (propriétés du script)',
    () => PropertiesService.getScriptProperties().getProperty(RANGEMENT_PROPRIETE_DOMAINES_), '');
  return [...new Set([rangementDomaineDe_(adresse), ...rangementNormaliserDomaines_(declares)])]
    .filter((d) => d !== '');
};

const rangementContexte_ = () => {
  const apropos = rangementAppel_(() => Drive.About.get({ fields: 'user(emailAddress,displayName)' }));
  const adresse = String((apropos.user && apropos.user.emailAddress) || '').toLowerCase();
  const racine = rangementAppel_(() => Drive.Files.get('root', { fields: 'id' }));
  return {
    version: RANGEMENT_VERSION_,
    adresse,
    nom: (apropos.user && apropos.user.displayName) || adresse,
    racineId: racine.id,
    domainesInternes: rangementDomainesInternes_(adresse),
    aujourdhui: SocleDates.maintenantJour(),
    reglages: rangementLireReglages_(),
    reglagesParDefaut: RANGEMENT_REGLAGES_DEFAUT_,
    ia: rangementEtatIa_(),
    plan: SocleErreurs.absorber('pointeur du plan illisible', () => rangementPlanCourant_(), null),
    absorptions: SocleErreurs.bilan(),
  };
};

/**
 * Traduit un fichier de l'API en enregistrement compact.
 *
 * Toute date passe par SocleDates.jour : Drive horodate en UTC, et un fichier
 * modifié à 23 h 30 à Paris doit se ranger le bon jour. Une date absente rend
 * `''` — « non mesuré » — et jamais une date inventée.
 */
const rangementEnregistrement_ = (fichier) => {
  const aMoi = fichier.ownedByMe === true;
  const proprietaire = aMoi ? ''
    : String(((fichier.owners || [])[0] || {}).emailAddress || '').toLowerCase();
  const modificateur = fichier.lastModifyingUser || null;
  const permissions = Array.isArray(fichier.permissions)
    ? fichier.permissions
      .filter((p) => p.deleted !== true && p.role !== 'owner')
      .map((p) => ({
        type: p.type || '',
        role: p.role || '',
        adresse: String(p.emailAddress || '').toLowerCase(),
        domaine: String(p.domain || '').toLowerCase(),
      }))
    : null;

  return {
    id: fichier.id,
    nom: String(fichier.name ?? ''),
    genre: rangementGenre_(fichier.mimeType),
    parent: (fichier.parents || [])[0] || '',
    aMoi,
    proprietaire,
    cree: SocleDates.jour(fichier.createdTime),
    modifie: SocleDates.jour(fichier.modifiedTime),
    vu: SocleDates.jour(fichier.viewedByMeTime),
    octets: Number(fichier.quotaBytesUsed) || 0,
    partage: fichier.shared === true,
    // Trois états, pas deux : moi, quelqu'un d'autre, ou inconnu (Google omet
    // parfois le champ, notamment pour un compte supprimé).
    modifiePar: !modificateur ? ''
      : (modificateur.me === true ? 'moi' : String(modificateur.emailAddress || '?').toLowerCase()),
    permissions,
    cible: (fichier.shortcutDetails && fichier.shortcutDetails.targetId) || '',
  };
};

/**
 * Une page de Mon Drive et de « Partagés avec moi ».
 *
 * `corpora: 'user'` ne rend pas le contenu des Drives partagés : ce n'est pas
 * ce qu'on range ici. Les éléments partagés avec l'utilisateur mais hors de son
 * arborescence reviennent aussi ; l'analyse les reconnaît et les met de côté,
 * parce qu'on ne peut pas les distinguer ici sans connaître tout l'arbre.
 */
const rangementPage_ = (jeton) => {
  const reponse = rangementAppel_(() => Drive.Files.list({
    q: 'trashed = false',
    corpora: 'user',
    spaces: 'drive',
    pageSize: RANGEMENT_TAILLE_PAGE_,
    pageToken: jeton || null,
    fields: RANGEMENT_CHAMPS_FICHIERS_,
  }));
  return {
    elements: (reponse.files || []).map(rangementEnregistrement_),
    jetonSuivant: reponse.nextPageToken || null,
  };
};

/**
 * Drives partagés dont l'utilisateur est membre, avec leurs membres.
 *
 * Un appel par Drive : la liste est bornée par un budget de temps, et un
 * parcours arrêté en chemin se dit incomplet. Un Drive dont les membres n'ont
 * pas pu être lus garde `membres: null` — il ne sera rapproché d'aucun
 * candidat, et le rapport le dit, plutôt que de le croire vide.
 */
const rangementListerDrivesPartages_ = () => {
  const debut = Date.now();
  const permet = () => Date.now() - debut < RANGEMENT_BUDGET_DRIVES_MS_;

  const liste = SocleApi.parcourir(
    (jeton) => rangementAppel_(() => Drive.Drives.list({
      pageSize: 100, pageToken: jeton, fields: 'nextPageToken, drives(id,name)',
    })),
    { champ: 'drives', permet });

  let complet = liste.complet;
  const drives = liste.elements.map((drive) => {
    if (!permet()) {
      complet = false;
      return { id: drive.id, nom: drive.name, membres: null };
    }
    const membres = SocleErreurs.absorber('membres d’un Drive partagé illisibles', () => SocleApi.parcourir(
      (jeton) => rangementAppel_(() => Drive.Permissions.list(drive.id, {
        supportsAllDrives: true, pageSize: 100, pageToken: jeton,
        fields: 'nextPageToken, permissions(type,role,emailAddress,domain,deleted)',
      })),
      { champ: 'permissions' }).elements
      .filter((p) => p.deleted !== true)
      .map((p) => ({
        type: p.type || '',
        role: p.role || '',
        adresse: String(p.emailAddress || '').toLowerCase(),
        domaine: String(p.domain || '').toLowerCase(),
      })), null);
    return { id: drive.id, nom: drive.name, membres };
  });

  return { drives, complet, absorptions: SocleErreurs.bilan() };
};
