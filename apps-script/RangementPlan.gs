/**
 * Rangement Drive — le plan, puis son application. Introduit en v0.2.
 *
 * Trois temps, et jamais deux :
 *
 *   1. **Préparer.** L'outil écrit un classeur « Plan de rangement » dans le
 *      Drive de la personne : une ligne par action, rien n'est coché.
 *   2. **Valider.** La personne relit dans Sheets, coche ce qu'elle approuve,
 *      corrige une destination si elle veut. Une ligne non cochée ne sera
 *      jamais traitée.
 *   3. **Appliquer.** L'application annonce le nombre exact de lignes, demande
 *      confirmation, puis traite la file ligne à ligne en écrivant l'état de
 *      chacune au moment où elle est traitée (module PlanPuisApplication).
 *
 * Ce que l'outil fait lui-même, et ce qu'il laisse à la main :
 *
 *   automatique  ranger, archiver, regrouper, rattacher dans Mon Drive ;
 *                créer un Drive partagé ; y ajouter les membres proposés ;
 *   à la main    déplacer un **dossier** de Mon Drive vers un Drive partagé.
 *                L'API Drive le refuse (teamDrivesFolderMoveInNotSupported) et
 *                Google renvoie vers l'interface Drive, qui conserve
 *                l'identifiant du dossier — donc les liens — et applique elle-
 *                même ses règles sur les fichiers d'externes. Recréer
 *                l'arborescence et y déplacer les fichiers un à un, le seul
 *                contournement par l'API, casserait tous les liens vers les
 *                dossiers. L'outil prépare la liste, puis **vérifie** que le
 *                déplacement a eu lieu.
 *
 * Chaque ligne automatique est **rejouable sans dommage** : avant d'agir, on
 * relit l'état réel. Un élément déjà à destination est constaté, pas déplacé
 * deux fois ; un élément qui a bougé depuis la préparation est laissé où il
 * est. C'est ce qui autorise la politique « rejouer » du module de plan.
 *
 * Aucune suppression, aucune mise à la corbeille, aucun renommage : le banc
 * vérifie qu'aucun appel de ce genre n'existe dans le projet.
 */

const RANGEMENT_PROPRIETE_PLAN_ = 'RANGEMENT_PLAN';
const RANGEMENT_PROPRIETE_APPLICATION_ = 'RANGEMENT_APPLICATION';

const RANGEMENT_ONGLET_PLAN_ = 'Plan';
const RANGEMENT_ONGLET_MANUEL_ = 'À déplacer dans Drive';
const RANGEMENT_ONGLET_AIDE_ = 'Mode d\'emploi';
const RANGEMENT_DOSSIER_PLANS_ = 'Rangement Drive — plans';

/** Les libellés d'action sont écrits tels quels dans le plan : c'est ce que lit l'humain. */
const RANGEMENT_ACTIONS_ = {
  ranger: 'Ranger',
  archiver: 'Archiver',
  regrouper: 'Regrouper',
  rattacher: 'Rattacher',
  creerDrive: 'Créer le Drive partagé',
  ajouterMembre: 'Ajouter au Drive partagé',
};

const RANGEMENT_ACTIONS_DEPLACEMENT_ = [
  RANGEMENT_ACTIONS_.ranger, RANGEMENT_ACTIONS_.archiver,
  RANGEMENT_ACTIONS_.regrouper, RANGEMENT_ACTIONS_.rattacher,
];

/**
 * Rôles qu'un plan peut attribuer dans un Drive partagé. « Gestionnaire »
 * n'y est pas : donner le droit de supprimer le Drive et d'en retirer des
 * membres reste un geste à faire dans Drive, en connaissance de cause.
 */
const RANGEMENT_ROLES_DRIVE_ = {
  'Gestionnaire de contenu': 'fileOrganizer',
  Contributeur: 'writer',
  Commentateur: 'commenter',
  Lecteur: 'reader',
};

const RANGEMENT_COLONNES_PLAN_ = [
  'Action', 'Élément', 'Emplacement actuel', 'Destination', 'Rôle', 'Pourquoi', 'Certitude',
  'Lien', 'Clé', 'Dépend de',
  'ID élément', 'ID parent d\'origine', 'ID destination', 'Destination prévue', 'Jeton de création',
  'Type de membre',
];

/** Colonnes techniques, masquées : l'humain n'a pas à les lire, le code en a besoin. */
const RANGEMENT_COLONNES_MASQUEES_ = [
  'ID élément', 'ID parent d\'origine', 'ID destination', 'Destination prévue', 'Jeton de création',
  'Type de membre',
];

const RANGEMENT_COLONNES_MANUEL_ = [
  'Dossier', 'Emplacement actuel', 'Drive partagé', 'Remarque', 'Ouvrir le dossier',
  'Ouvrir le Drive partagé', 'État', 'Vérifié le', 'ID dossier', 'ID Drive', 'Clé Drive',
];

const RANGEMENT_PLAN_LIGNES_MAX_ = 20000;
const RANGEMENT_MIME_TABLEUR_ = 'application/vnd.google-apps.spreadsheet';

/**
 * Budgets : court quand le navigateur attend, pour que la progression
 * s'affiche ; long quand un déclencheur prend le relais, fenêtre fermée.
 */
const RANGEMENT_BUDGET_NAVIGATEUR_MS_ = 40 * 1000;
const RANGEMENT_BUDGET_ARRIERE_PLAN_MS_ = 4 * 60 * 1000;
const RANGEMENT_DUREE_UNITE_MS_ = 15 * 1000;

/** État d'une exécution : lignes à écrire, dossiers déjà résolus. Objet `const` muté en place. */
const RANGEMENT_PLAN_MEMOIRE_ = { lignes: [], dossiers: {}, destinations: {}, racine: '', operations: {} };

/* ------------------------------------------------------------ outils */

const rangementTexteBrut_ = (valeur) => String(valeur ?? '').trim();

/**
 * Une valeur qui commence par =, +, - ou @ deviendrait une formule dans
 * Sheets. Un nom de fichier « =IMPORTXML(…) » s'exécuterait alors dans le plan
 * de la personne. L'apostrophe initiale force le texte, et Sheets ne
 * l'affiche pas.
 */
const rangementEnTexte_ = (valeur) => {
  const texte = String(valeur ?? '');
  return /^[=+\-@]/.test(texte) ? `'${texte}` : texte;
};

const rangementUrlDrive_ = (id, dossier) => (dossier
  ? `https://drive.google.com/drive/folders/${id}`
  : `https://drive.google.com/open?id=${id}`);

/** Échappe une valeur pour la syntaxe de recherche de Drive (`q`). */
const rangementEchapperRequete_ = (texte) => String(texte).replace(/\\/g, '\\\\').replace(/'/g, "\\'");

const rangementPlanCourant_ = () => {
  const brut = PropertiesService.getUserProperties().getProperty(RANGEMENT_PROPRIETE_PLAN_);
  return brut ? JSON.parse(brut) : null;
};

const rangementClasseurPlan_ = () => {
  const plan = rangementPlanCourant_();
  if (!plan) {
    throw SocleErreurs.erreur({
      quoi: 'Aucun plan de rangement n\'a été préparé.',
      quoiFaire: 'Lancez une analyse, puis « Préparer le plan » dans l\'onglet Hiérarchie proposée.',
    });
  }
  try {
    return SpreadsheetApp.openById(plan.id);
  } catch (e) {
    throw SocleErreurs.erreur({
      quoi: 'Le classeur du plan est introuvable : il a peut-être été supprimé.',
      quoiFaire: 'Préparez un nouveau plan depuis l\'onglet Hiérarchie proposée.',
      cause: e.message,
    });
  }
};

/** Index en-tête → position. Les colonnes se retrouvent par leur nom, jamais par indice. */
const rangementIndexEntete_ = (entete) => {
  const index = {};
  entete.forEach((titre, position) => {
    const nom = rangementTexteBrut_(titre);
    if (nom !== '' && !(nom in index)) index[nom] = position;
  });
  return index;
};

/** Lit un onglet en objets indexés par en-tête, avec leur numéro de ligne. */
const rangementLireOnglet_ = (classeur, nom) => {
  const feuille = classeur.getSheetByName(nom);
  if (!feuille || feuille.getLastRow() < 1) return { feuille, index: {}, lignes: [] };
  const valeurs = feuille.getRange(1, 1, feuille.getLastRow(), feuille.getLastColumn()).getValues();
  const index = rangementIndexEntete_(valeurs[0]);
  const lignes = valeurs.slice(1).map((cellules, rang) => {
    const ligne = { numero: rang + 2 };
    Object.keys(index).forEach((titre) => { ligne[titre] = cellules[index[titre]]; });
    return ligne;
  });
  return { feuille, index, lignes };
};

const rangementEcrireCellule_ = (feuille, index, numero, titre, valeur) => {
  if (!(titre in index)) {
    throw SocleErreurs.erreur({
      quoi: `La colonne « ${titre} » a disparu du plan.`,
      quoiFaire: 'Ne supprimez pas de colonne du plan (les masquées comprises) ; préparez-en un nouveau.',
    });
  }
  feuille.getRange(numero, index[titre] + 1).setValues([[valeur]]);
  // Écrite avant tout autre appel : une exécution tuée ensuite ne doit pas
  // perdre, par exemple, l'identifiant d'un Drive partagé qu'on vient de créer.
  SpreadsheetApp.flush();
};

/* ------------------------------------------------------------ préparer */

/**
 * Revalide la proposition du navigateur. Elle ne vaut qu'une suggestion : le
 * plan la montre à un humain, et l'application relit l'état réel de chaque
 * élément avant d'agir. On vérifie surtout la forme — un plan malformé
 * produirait des lignes que personne ne peut relire.
 */
const rangementValiderProposition_ = (proposition) => {
  const refuser = (quoi) => SocleErreurs.erreur({
    quoi: `La proposition de plan est invalide : ${quoi}.`,
    quoiFaire: 'Relancez l\'analyse puis la préparation du plan. Si le défaut persiste, signalez-le.',
  });
  const p = proposition && typeof proposition === 'object' ? proposition : {};
  const mouvements = Array.isArray(p.mouvements) ? p.mouvements : [];
  const drives = Array.isArray(p.drivesACreer) ? p.drivesACreer : [];
  const manuels = Array.isArray(p.deplacementsManuels) ? p.deplacementsManuels : [];
  if (mouvements.length + drives.length + manuels.length === 0) throw refuser('aucune action');
  if (mouvements.length > RANGEMENT_PLAN_LIGNES_MAX_) throw refuser(`plus de ${RANGEMENT_PLAN_LIGNES_MAX_} déplacements`);

  const identifiant = (v) => /^[A-Za-z0-9_-]{5,200}$/.test(String(v ?? ''));
  const cle = (v) => /^DP\d{1,4}$/.test(String(v ?? ''));
  const actionsConnues = { ranger: 1, archiver: 1, regrouper: 1, rattacher: 1 };

  mouvements.forEach((m, rang) => {
    if (!actionsConnues[m.action]) throw refuser(`action « ${m.action} » en position ${rang}`);
    if (!identifiant(m.id)) throw refuser(`identifiant d'élément en position ${rang}`);
    if (m.parentId && !identifiant(m.parentId)) throw refuser(`parent d'origine en position ${rang}`);
    if (m.destinationId && !identifiant(m.destinationId)) throw refuser(`destination en position ${rang}`);
    const segments = Array.isArray(m.destination) ? m.destination : [];
    if (segments.length === 0 || segments.length > 10
      || segments.some((s) => rangementTexteBrut_(s) === '' || String(s).length > 200)) {
      throw refuser(`chemin de destination en position ${rang}`);
    }
  });
  drives.forEach((d, rang) => {
    if (!cle(d.cle) || rangementTexteBrut_(d.nom) === '' || String(d.nom).length > 100) {
      throw refuser(`Drive partagé à créer en position ${rang}`);
    }
    (d.membres || []).forEach((m) => {
      if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(String(m.adresse || ''))) throw refuser(`adresse de membre « ${m.adresse} »`);
      if (!(m.role in RANGEMENT_ROLES_DRIVE_)) throw refuser(`rôle « ${m.role} »`);
    });
  });
  manuels.forEach((m, rang) => {
    if (!identifiant(m.id)) throw refuser(`dossier à déplacer à la main en position ${rang}`);
    if (!(identifiant(m.driveId) || cle(m.cleDrive))) throw refuser(`Drive de destination en position ${rang}`);
  });
  return { mouvements, drives, manuels };
};

/** Les lignes du plan, dans l'ordre où elles seront traitées : créer, peupler, ranger. */
const rangementLignesPlan_ = ({ mouvements, drives }) => {
  const lignes = [];
  drives.forEach((d) => {
    lignes.push({
      Action: RANGEMENT_ACTIONS_.creerDrive,
      Élément: rangementEnTexte_(d.nom),
      Pourquoi: rangementEnTexte_(d.raison || 'Dossiers d\'équipe hébergés dans Mon Drive.'),
      Certitude: 'présomption',
      Clé: d.cle,
      'Jeton de création': Utilities.getUuid(),
    });
    (d.membres || []).forEach((m) => {
      lignes.push({
        Action: RANGEMENT_ACTIONS_.ajouterMembre,
        Élément: rangementEnTexte_(m.adresse.toLowerCase()),
        Destination: rangementEnTexte_(d.nom),
        Rôle: m.role,
        Pourquoi: 'Collègue en droit d\'écriture sur les dossiers d\'origine. Google lui enverra une notification.',
        Certitude: 'fait',
        'Dépend de': d.cle,
        'Type de membre': m.groupe === true ? 'group' : 'user',
      });
    });
  });
  mouvements.forEach((m, rang) => {
    const destination = m.destination.map(rangementTexteBrut_).join(' / ');
    lignes.push({
      Action: RANGEMENT_ACTIONS_[m.action],
      Élément: rangementEnTexte_(m.nom),
      'Emplacement actuel': rangementEnTexte_(m.chemin),
      Destination: rangementEnTexte_(destination),
      Pourquoi: rangementEnTexte_(m.raison),
      Certitude: m.certitude === 'fait' ? 'fait' : 'présomption',
      Lien: rangementUrlDrive_(m.id, m.genre === 'dossier'),
      Clé: `L${rang + 1}`,
      'ID élément': m.id,
      'ID parent d\'origine': m.parentId || '',
      'ID destination': m.destinationId || '',
      'Destination prévue': rangementEnTexte_(destination),
    });
  });
  return lignes;
};

const RANGEMENT_MODE_EMPLOI_ = [
  ['Plan de rangement — mode d\'emploi'],
  [''],
  ['1. Relisez l\'onglet « Plan ». Rien n\'est encore fait.'],
  ['2. Cochez « Valider » sur chaque ligne que vous approuvez. Une ligne non cochée ne sera jamais traitée.'],
  ['   Astuce : sélectionnez plusieurs cases puis appuyez sur Espace pour les cocher d\'un coup.'],
  ['3. Vous pouvez corriger la colonne « Destination » d\'un rangement : c\'est un chemin sous Mon Drive,'],
  ['   niveaux séparés par « / ». Les dossiers manquants seront créés.'],
  ['4. Revenez dans l\'application, onglet « Application » : elle annonce le nombre exact de lignes, puis applique.'],
  [''],
  ['La colonne « État » est tenue par l\'outil :'],
  ['   À faire — pas encore traitée · En cours — en train · Fait — appliquée et enregistrée'],
  ['   À reprendre — erreur passagère, sera rejouée · Échec — la colonne Détail dit pourquoi'],
  ['   Abandonné — trop de tentatives interrompues · À vérifier — interrompue, à contrôler'],
  [''],
  ['Avant d\'agir, l\'outil relit l\'état réel : un élément déplacé depuis la préparation est laissé où il est,'],
  ['un élément déjà à destination est constaté, jamais déplacé deux fois. Rien n\'est supprimé ni mis à la corbeille.'],
  [''],
  ['L\'onglet « À déplacer dans Drive » liste les dossiers à faire glisser vous-même vers un Drive partagé :'],
  ['Google ne permet pas de le faire par programme, et son interface garde les liens intacts.'],
];

/** Range le classeur du plan dans un dossier dédié plutôt qu'à la racine qu'on veut désencombrer. */
const rangementRangerClasseur_ = (idClasseur) => {
  const racine = rangementAppel_(() => Drive.Files.get('root', { fields: 'id' })).id;
  const trouves = rangementAppel_(() => Drive.Files.list({
    q: `'${racine}' in parents and name = '${rangementEchapperRequete_(RANGEMENT_DOSSIER_PLANS_)}' `
      + `and mimeType = '${RANGEMENT_MIME_DOSSIER_}' and trashed = false`,
    fields: 'files(id)', pageSize: 2, corpora: 'user', spaces: 'drive',
  })).files || [];
  const dossier = trouves.length > 0 ? trouves[0].id : rangementAppel_(() => Drive.Files.create({
    name: RANGEMENT_DOSSIER_PLANS_, mimeType: RANGEMENT_MIME_DOSSIER_, parents: [racine],
  })).id;
  rangementAppel_(() => Drive.Files.update({}, idClasseur, null, {
    addParents: dossier, removeParents: racine, fields: 'id',
  }));
};

const rangementPreparer_ = (proposition) => {
  const propre = rangementValiderProposition_(proposition);
  const horodatage = SocleDates.maintenantHorodatage();
  const titre = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm');
  const classeur = SpreadsheetApp.create(`Plan de rangement Drive — ${titre}`);
  const id = classeur.getId();

  // Le pointeur est posé tout de suite : un plan à moitié écrit se retrouve,
  // il ne devient pas un fichier orphelin que personne ne rouvrira.
  PropertiesService.getUserProperties().setProperty(RANGEMENT_PROPRIETE_PLAN_,
    JSON.stringify({ id, url: classeur.getUrl(), cree: horodatage }));
  // Un nouveau plan remplace l'ancien : une application encore en cours sur
  // l'ancien s'arrête, déclencheur compris.
  rangementArreter_();

  const aide = classeur.getSheets()[0];
  aide.setName(RANGEMENT_ONGLET_AIDE_);
  aide.getRange(1, 1, RANGEMENT_MODE_EMPLOI_.length, 1).setValues(RANGEMENT_MODE_EMPLOI_);
  aide.getRange(1, 1).setFontWeight('bold');

  RANGEMENT_PLAN_MEMOIRE_.lignes = rangementLignesPlan_(propre);
  const operation = rangementOperation_(RANGEMENT_BUDGET_NAVIGATEUR_MS_);
  const prepare = operation.preparer();

  const lu = rangementLireOnglet_(classeur, RANGEMENT_ONGLET_PLAN_);
  RANGEMENT_COLONNES_MASQUEES_.forEach((titre) => lu.feuille.hideColumns(lu.index[titre] + 1));

  const manuel = classeur.insertSheet(RANGEMENT_ONGLET_MANUEL_);
  const corpsManuel = propre.manuels.map((m) => [
    rangementEnTexte_(m.nom), rangementEnTexte_(m.chemin), rangementEnTexte_(m.drive),
    rangementEnTexte_(m.remarque || ''), rangementUrlDrive_(m.id, true),
    m.driveId ? rangementUrlDrive_(m.driveId, true) : 'après création du Drive partagé',
    'À faire', '', m.id, m.driveId || '', m.cleDrive || '',
  ]);
  manuel.getRange(1, 1, 1, RANGEMENT_COLONNES_MANUEL_.length).setValues([RANGEMENT_COLONNES_MANUEL_]).setFontWeight('bold');
  if (corpsManuel.length > 0) {
    manuel.getRange(2, 1, corpsManuel.length, RANGEMENT_COLONNES_MANUEL_.length).setValues(corpsManuel);
  }
  manuel.setFrozenRows(1);
  ['ID dossier', 'ID Drive', 'Clé Drive'].forEach((titre) => {
    manuel.hideColumns(RANGEMENT_COLONNES_MANUEL_.indexOf(titre) + 1);
  });
  SpreadsheetApp.flush();

  SocleErreurs.absorber('rangement du classeur du plan dans son dossier',
    () => rangementRangerClasseur_(id), null);

  return {
    id, url: classeur.getUrl(), cree: horodatage,
    lignes: prepare.lignes, manuels: corpsManuel.length,
    absorptions: SocleErreurs.bilan(),
  };
};

/* ------------------------------------------------------------ appliquer : une unité */

const rangementRacine_ = () => {
  if (!RANGEMENT_PLAN_MEMOIRE_.racine) {
    RANGEMENT_PLAN_MEMOIRE_.racine = rangementAppel_(() => Drive.Files.get('root', { fields: 'id' })).id;
  }
  return RANGEMENT_PLAN_MEMOIRE_.racine;
};

/**
 * Le dossier `nom` sous `parent`, créé s'il manque.
 *
 * Retrouvé par son nom **avant** d'être créé : une exécution tuée juste après
 * une création ne produit pas de doublon à la reprise. Deux dossiers du même
 * nom au même endroit, en revanche, c'est une ambiguïté que l'outil ne tranche
 * pas à la place de la personne.
 */
const rangementDossierSous_ = (parent, nom) => {
  const cle = `${parent}/${nom}`;
  if (RANGEMENT_PLAN_MEMOIRE_.dossiers[cle]) return RANGEMENT_PLAN_MEMOIRE_.dossiers[cle];
  const trouves = rangementAppel_(() => Drive.Files.list({
    q: `'${parent}' in parents and name = '${rangementEchapperRequete_(nom)}' `
      + `and mimeType = '${RANGEMENT_MIME_DOSSIER_}' and trashed = false`,
    fields: 'files(id)', pageSize: 3, corpora: 'user', spaces: 'drive',
  })).files || [];
  if (trouves.length > 1) {
    throw SocleErreurs.erreur({
      quoi: `Il existe plusieurs dossiers « ${nom} » au même endroit.`,
      quoiFaire: 'Renommez l\'un d\'eux, ou corrigez la colonne Destination, puis remettez la ligne « À faire ».',
    });
  }
  const id = trouves.length === 1 ? trouves[0].id : rangementAppel_(() => Drive.Files.create({
    name: nom, mimeType: RANGEMENT_MIME_DOSSIER_, parents: [parent],
  }, null, { fields: 'id' })).id;
  RANGEMENT_PLAN_MEMOIRE_.dossiers[cle] = id;
  return id;
};

/**
 * L'identifiant du dossier de destination.
 *
 * Si la personne a modifié la colonne Destination, c'est **son** chemin qui
 * fait foi, résolu nom par nom depuis Mon Drive ; l'identifiant préparé par
 * l'outil est alors ignoré. Le référentiel humain l'emporte sur le calcul.
 */
const rangementDestination_ = (vue) => {
  const texte = rangementTexteBrut_(vue.Destination).replace(/^'/, '');
  const prevue = rangementTexteBrut_(vue['Destination prévue']).replace(/^'/, '');
  const identifiant = rangementTexteBrut_(vue['ID destination']);
  if (identifiant && texte === prevue) {
    // Vérifiée une fois par exécution : trois cents fichiers rangés dans
    // « Compta » ne demandent pas trois cents fois si « Compta » existe.
    if (RANGEMENT_PLAN_MEMOIRE_.destinations[identifiant]) return identifiant;
    const dossier = rangementAppel_(() => Drive.Files.get(identifiant, {
      fields: 'id,trashed,mimeType', supportsAllDrives: true,
    }));
    if (dossier.trashed || dossier.mimeType !== RANGEMENT_MIME_DOSSIER_) {
      throw SocleErreurs.erreur({
        quoi: 'Le dossier de destination est à la corbeille, ou n\'est plus un dossier.',
        quoiFaire: 'Corrigez la colonne Destination, puis remettez la ligne « À faire ».',
      });
    }
    RANGEMENT_PLAN_MEMOIRE_.destinations[identifiant] = true;
    return identifiant;
  }
  const segments = texte.split('/').map((s) => s.trim()).filter((s) => s !== '');
  if (segments.length === 0) {
    throw SocleErreurs.erreur({
      quoi: 'La colonne Destination est vide.',
      quoiFaire: 'Indiquez un chemin sous Mon Drive, par exemple « Archives / 2024 ».',
    });
  }
  return segments.reduce((parent, nom) => rangementDossierSous_(parent, nom), rangementRacine_());
};

const rangementDeplacer_ = (vue) => {
  const id = rangementTexteBrut_(vue['ID élément']);
  const origine = rangementTexteBrut_(vue['ID parent d\'origine']);
  let element;
  try {
    element = rangementAppel_(() => Drive.Files.get(id, {
      fields: 'id,parents,trashed,driveId', supportsAllDrives: true,
    }));
  } catch (e) {
    if (SocleReprises.estTransitoire(e)) throw e;
    throw SocleErreurs.erreur({
      quoi: 'L\'élément n\'existe plus, ou vous n\'y avez plus accès.',
      quoiFaire: 'Rien à faire : la ligne est sans objet.',
      cause: e.message,
    });
  }
  if (element.trashed) {
    throw SocleErreurs.erreur({ quoi: 'L\'élément est à la corbeille.', quoiFaire: 'Laissé en place.' });
  }
  if (element.driveId) {
    throw SocleErreurs.erreur({
      quoi: 'L\'élément est désormais dans un Drive partagé.', quoiFaire: 'Laissé en place.',
    });
  }

  const destination = rangementDestination_(vue);
  const parents = element.parents || [];
  if (parents.includes(destination)) return 'Déjà à destination (constaté) : rien déplacé.';

  // Le garde-fou principal : si l'élément a bougé depuis la préparation, le
  // plan décrit un monde qui n'existe plus. On ne déplace pas sur la foi
  // d'une photo périmée.
  const attendus = origine ? [origine] : [];
  if (parents.length !== attendus.length || parents.some((p) => !attendus.includes(p))) {
    throw SocleErreurs.erreur({
      quoi: 'L\'élément a été déplacé depuis la préparation du plan.',
      quoiFaire: 'Laissé où il est. Relancez une analyse si vous voulez un plan à jour.',
    });
  }

  rangementAppel_(() => Drive.Files.update({}, id, null, {
    addParents: destination,
    ...(origine ? { removeParents: origine } : {}),
    supportsAllDrives: true,
    fields: 'id,parents',
  }));
  return `Déplacé vers « ${rangementTexteBrut_(vue.Destination).replace(/^'/, '')} ».`;
};

/**
 * Crée le Drive partagé, idempotent par son jeton de création.
 *
 * L'API promet qu'un même jeton ne crée jamais deux Drives : un second appel
 * échoue (409). Si l'exécution a été tuée entre la création et l'écriture de
 * l'identifiant, on le retrouve donc par son nom.
 *
 * Mais un échec a d'autres causes — la plus courante : l'organisation
 * interdit aux utilisateurs de créer des Drives partagés. Adopter alors un
 * homonyme reviendrait à prendre le Drive d'un collègue pour le sien et à y
 * ajouter des membres. Un Drive retrouvé par son nom n'est donc adopté que si
 * deux conditions tiennent : cette ligne a déjà été tentée (au premier départ,
 * il n'existe aucune création antérieure à retrouver), et il a été créé après
 * la préparation du plan. Sinon, la ligne échoue en disant quoi faire, et la
 * file continue.
 */
const rangementCreerDrive_ = (vue, feuille, index) => {
  const deja = rangementTexteBrut_(vue['ID destination']);
  if (deja) {
    rangementAppel_(() => Drive.Drives.get(deja, { fields: 'id' }));
    return `Déjà créé (constaté) : ${deja}.`;
  }
  const nom = rangementTexteBrut_(vue['Élément']).replace(/^'/, '');
  let drive;
  try {
    drive = rangementAppel_(() => Drive.Drives.create({ name: nom }, rangementTexteBrut_(vue['Jeton de création'])));
  } catch (e) {
    if (SocleReprises.estTransitoire(e)) throw e;
    const cree = rangementTexteBrut_((rangementPlanCourant_() || {}).cree);
    const homonymes = Number(vue.departs) > 1 && cree ? (rangementAppel_(() => Drive.Drives.list({
      q: `name = '${rangementEchapperRequete_(nom)}'`, fields: 'drives(id,name,createdTime)', pageSize: 10,
    })).drives || []).filter((d) => SocleDates.horodatage(d.createdTime) >= cree) : [];
    if (homonymes.length !== 1) {
      throw SocleErreurs.erreur({
        quoi: `Le Drive partagé « ${nom} » n'a pas pu être créé.`,
        quoiFaire: 'Vérifiez que votre organisation vous autorise à créer des Drives partagés '
          + '(sinon, demandez-le à l\'administrateur), puis remettez la ligne « À faire ».',
        cause: e.message,
      });
    }
    drive = homonymes[0];
  }
  rangementEcrireCellule_(feuille, index, vue.numeroDeLigne, 'ID destination', drive.id);
  return `Créé : ${rangementUrlDrive_(drive.id, true)}`;
};

/** L'identifiant du Drive créé par la ligne dont la clé est `cle`, lu dans le plan. */
const rangementDriveDeCle_ = (classeur, cle) => {
  const plan = rangementLireOnglet_(classeur, RANGEMENT_ONGLET_PLAN_);
  const ligne = plan.lignes.find((l) => rangementTexteBrut_(l['Clé']) === cle
    && rangementTexteBrut_(l.Action) === RANGEMENT_ACTIONS_.creerDrive);
  return ligne ? rangementTexteBrut_(ligne['ID destination']) : '';
};

const rangementAjouterMembre_ = (vue, classeur) => {
  const cle = rangementTexteBrut_(vue['Dépend de']);
  const driveId = rangementDriveDeCle_(classeur, cle);
  if (!driveId) {
    throw SocleErreurs.erreur({
      quoi: 'Le Drive partagé de cette ligne n\'est pas créé.',
      quoiFaire: `Cochez aussi la ligne « ${RANGEMENT_ACTIONS_.creerDrive} » de clé ${cle}, `
        + 'puis remettez celle-ci « À faire ».',
    });
  }
  const role = RANGEMENT_ROLES_DRIVE_[rangementTexteBrut_(vue['Rôle'])];
  if (!role) {
    throw SocleErreurs.erreur({
      quoi: `Le rôle « ${vue['Rôle']} » n'est pas reconnu.`,
      quoiFaire: `Choisissez l'un de : ${Object.keys(RANGEMENT_ROLES_DRIVE_).join(', ')}.`,
    });
  }
  const adresse = rangementTexteBrut_(vue['Élément']).replace(/^'/, '').toLowerCase();
  const membres = SocleApi.parcourir((jeton) => rangementAppel_(() => Drive.Permissions.list(driveId, {
    supportsAllDrives: true, pageSize: 100, pageToken: jeton, fields: 'nextPageToken, permissions(emailAddress,role)',
  })), { champ: 'permissions' }).elements;
  if (membres.some((m) => String(m.emailAddress || '').toLowerCase() === adresse)) {
    return 'Déjà membre (constaté) : rôle inchangé.';
  }
  rangementAppel_(() => Drive.Permissions.create({
    type: rangementTexteBrut_(vue['Type de membre']) === 'group' ? 'group' : 'user',
    role,
    emailAddress: adresse,
  }, driveId, { supportsAllDrives: true, sendNotificationEmail: true, fields: 'id' }));
  return `Ajouté comme ${rangementTexteBrut_(vue['Rôle']).toLowerCase()}.`;
};

/* ------------------------------------------------------------ l'opération */

/**
 * L'opération du module de plan, mémorisée par budget. Jamais évaluée au
 * chargement : l'ordre des fichiers n'est pas garanti, et PlanPuisApplication
 * pourrait ne pas être encore défini.
 */
const rangementOperation_ = (budgetMs) => {
  const cle = `budget-${budgetMs}`;
  if (RANGEMENT_PLAN_MEMOIRE_.operations[cle]) return RANGEMENT_PLAN_MEMOIRE_.operations[cle];
  RANGEMENT_PLAN_MEMOIRE_.operations[cle] = PlanPuisApplication.declarer({
    cle: 'rangement',
    onglet: RANGEMENT_ONGLET_PLAN_,
    colonnes: RANGEMENT_COLONNES_PLAN_,
    fonctionDeReprise: 'rangementReprendreApplication',
    classeur: rangementClasseurPlan_,
    // Verrou de la personne : deux onglets ouverts, ou un onglet et le
    // déclencheur de reprise, ne doivent pas traiter la même file. Celui d'un
    // autre utilisateur n'a rien à voir, d'où ni verrou de script ni de document.
    verrou: () => LockService.getUserLock(),
    budgetMs,
    dureeUniteMs: RANGEMENT_DUREE_UNITE_MS_,
    surInterruption: 'rejouer',
    departsMax: 3,
    estTransitoire: SocleReprises.estTransitoire,
    construirePlan: () => RANGEMENT_PLAN_MEMOIRE_.lignes,
    appliquerUnite: (vue) => {
      const action = rangementTexteBrut_(vue.Action);
      if (RANGEMENT_ACTIONS_DEPLACEMENT_.includes(action)) return rangementDeplacer_(vue);
      const classeur = rangementClasseurPlan_();
      if (action === RANGEMENT_ACTIONS_.creerDrive) {
        const plan = rangementLireOnglet_(classeur, RANGEMENT_ONGLET_PLAN_);
        return rangementCreerDrive_(vue, plan.feuille, plan.index);
      }
      if (action === RANGEMENT_ACTIONS_.ajouterMembre) return rangementAjouterMembre_(vue, classeur);
      throw SocleErreurs.erreur({
        quoi: `L'action « ${action} » n'est pas reconnue.`,
        quoiFaire: 'Ne modifiez pas la colonne Action ; préparez un nouveau plan si besoin.',
      });
    },
  });
  return RANGEMENT_PLAN_MEMOIRE_.operations[cle];
};

/* ------------------------------------------------------------ état, application, vérification */

/**
 * Ce que l'application ferait maintenant, compté exactement. C'est ce nombre
 * que la personne confirme, et celui que le lancement revérifie.
 */
const rangementEtat_ = () => {
  const courant = rangementPlanCourant_();
  if (!courant) return { plan: null };
  const classeur = rangementClasseurPlan_();
  const plan = rangementLireOnglet_(classeur, RANGEMENT_ONGLET_PLAN_);
  const enAttente = ['', 'À faire', 'En cours', 'À reprendre'];
  const aTraiter = plan.lignes.filter((l) => l.Valider === true
    && enAttente.includes(rangementTexteBrut_(l['État'])));
  const parAction = {};
  aTraiter.forEach((l) => {
    const a = rangementTexteBrut_(l.Action);
    parAction[a] = (parAction[a] || 0) + 1;
  });
  const parEtat = {};
  plan.lignes.forEach((l) => {
    const e = rangementTexteBrut_(l['État']) || 'À faire';
    parEtat[e] = (parEtat[e] || 0) + 1;
  });
  const manuel = rangementLireOnglet_(classeur, RANGEMENT_ONGLET_MANUEL_);
  const application = PropertiesService.getUserProperties().getProperty(RANGEMENT_PROPRIETE_APPLICATION_);
  return {
    plan: courant,
    lignes: plan.lignes.length,
    validees: plan.lignes.filter((l) => l.Valider === true).length,
    aTraiter: aTraiter.length,
    parAction,
    parEtat,
    notifications: parAction[RANGEMENT_ACTIONS_.ajouterMembre] || 0,
    echecs: plan.lignes.filter((l) => rangementTexteBrut_(l['État']) === 'Échec')
      .slice(0, 50).map((l) => ({ ligne: l.numero, action: l.Action, element: l['Élément'], detail: l['Détail'] })),
    manuels: manuel.lignes.map((l) => ({
      ligne: l.numero,
      dossier: rangementTexteBrut_(l.Dossier).replace(/^'/, ''),
      drive: rangementTexteBrut_(l['Drive partagé']).replace(/^'/, ''),
      remarque: rangementTexteBrut_(l.Remarque),
      etat: rangementTexteBrut_(l['État']),
      verifie: SocleDates.horodatage(l['Vérifié le']),
      idDossier: rangementTexteBrut_(l['ID dossier']),
      idDrive: rangementTexteBrut_(l['ID Drive']) || rangementDriveDeCle_(classeur, rangementTexteBrut_(l['Clé Drive'])),
    })),
    enCours: application ? JSON.parse(application) : null,
  };
};

/**
 * Lance l'application après confirmation. `confirme` est le nombre annoncé à
 * la personne : s'il ne vaut plus le nombre réel, le plan a changé depuis sa
 * relecture, et l'on refuse plutôt que d'appliquer ce qu'elle n'a pas vu.
 */
const rangementLancer_ = (confirme) => {
  const etat = rangementEtat_();
  if (!etat.plan) rangementClasseurPlan_();   // lève, en disant quoi faire
  if (Number(confirme) !== etat.aTraiter) {
    throw SocleErreurs.erreur({
      quoi: `Le plan a changé depuis votre relecture : ${etat.aTraiter} ligne(s) à traiter, et non ${confirme}.`,
      quoiFaire: 'Relisez le nouveau décompte, puis confirmez de nouveau.',
    });
  }
  PropertiesService.getUserProperties().setProperty(RANGEMENT_PROPRIETE_APPLICATION_,
    JSON.stringify({ plan: etat.plan.id, depuis: SocleDates.maintenantHorodatage(), confirme: etat.aTraiter }));
  return rangementPoursuivre_(RANGEMENT_BUDGET_NAVIGATEUR_MS_);
};

/**
 * Un passage d'application. Sans autorisation en cours — jamais lancée, ou
 * arrêtée —, rien n'est fait : un déclencheur resté en place après un arrêt
 * ne doit pas reprendre de lui-même.
 */
const rangementPoursuivre_ = (budgetMs, depuisDeclencheur = false) => {
  const autorisation = PropertiesService.getUserProperties().getProperty(RANGEMENT_PROPRIETE_APPLICATION_);
  const courant = rangementPlanCourant_();
  if (!autorisation || !courant || JSON.parse(autorisation).plan !== courant.id) {
    return { arrete: true, message: 'Aucune application en cours.' };
  }
  const operation = rangementOperation_(budgetMs);
  const bilan = depuisDeclencheur ? operation.reprendre() : operation.appliquer();
  if (!bilan.refus && bilan.restant === 0) {
    PropertiesService.getUserProperties().deleteProperty(RANGEMENT_PROPRIETE_APPLICATION_);
  }
  return bilan;
};

const rangementArreter_ = () => {
  PropertiesService.getUserProperties().deleteProperty(RANGEMENT_PROPRIETE_APPLICATION_);
  let retires = 0;
  ScriptApp.getProjectTriggers().forEach((d) => {
    if (d.getHandlerFunction() === 'rangementReprendreApplication') {
      ScriptApp.deleteTrigger(d);
      retires += 1;
    }
  });
  return { arrete: true, declencheursRetires: retires };
};

/**
 * Vérifie, dossier par dossier, les déplacements à faire à la main. Un
 * dossier est déclaré déplacé quand Drive le situe dans le bon Drive partagé :
 * ce que la personne dit avoir fait ne compte pas, ce que Drive constate si.
 */
const rangementVerifierManuels_ = () => {
  const classeur = rangementClasseurPlan_();
  const manuel = rangementLireOnglet_(classeur, RANGEMENT_ONGLET_MANUEL_);
  if (manuel.lignes.length === 0) return { verifies: 0, deplaces: 0 };
  const maintenant = SocleDates.maintenantHorodatage();
  let deplaces = 0;
  const colonnes = ['État', 'Vérifié le', 'ID Drive', 'Ouvrir le Drive partagé'];
  manuel.lignes.forEach((l) => {
    const cible = rangementTexteBrut_(l['ID Drive']) || rangementDriveDeCle_(classeur, rangementTexteBrut_(l['Clé Drive']));
    let etat;
    if (!cible) etat = 'En attente : Drive partagé pas encore créé';
    else {
      const dossier = SocleErreurs.absorber('dossier à vérifier illisible', () => rangementAppel_(() => Drive.Files.get(
        rangementTexteBrut_(l['ID dossier']), { fields: 'id,driveId,trashed', supportsAllDrives: true })), null);
      if (!dossier) etat = 'Non vérifié : dossier illisible';
      else if (dossier.driveId === cible) { etat = 'Fait (constaté)'; deplaces += 1; }
      else if (dossier.driveId) etat = 'Dans un autre Drive partagé';
      else etat = 'À faire';
    }
    const valeurs = [etat, maintenant, cible, cible ? rangementUrlDrive_(cible, true) : l['Ouvrir le Drive partagé']];
    colonnes.forEach((titre, i) => {
      manuel.feuille.getRange(l.numero, manuel.index[titre] + 1).setValues([[valeurs[i]]]);
    });
  });
  SpreadsheetApp.flush();
  return { verifies: manuel.lignes.length, deplaces, absorptions: SocleErreurs.bilan() };
};
