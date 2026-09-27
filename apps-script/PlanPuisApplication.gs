/**
 * Plan puis application — le module, introduit en v0.1.
 *
 * Une opération irréversible se fait en deux temps : on écrit le plan dans un
 * onglet, un humain le relit et coche ce qu'il valide, puis on applique. Ce
 * fichier n'est pas une bibliothèque Apps Script : il se **recopie** dans le
 * projet hôte. Une bibliothèque ajouterait une dépendance de déploiement à
 * suivre ; un fichier versionné se lit, se modifie et se fige avec le projet
 * qui l'embarque.
 *
 * Conséquence directe sur les noms : tout ce qui est déclaré ici vit dans la
 * portée globale du projet hôte, et **deux constantes globales de même nom
 * empêchent le projet entier de se charger** — toutes ses fonctions deviennent
 * alors « introuvables » d'un coup, y compris celles qui n'ont rien à voir.
 * D'où le préfixe `ppa` sur chaque nom interne, et le nom long du seul objet
 * public.
 *
 * **Copie retouchée pour rangement-drive** (à remonter dans le dépôt
 * plan-puis-application) : deux champs facultatifs de la définition,
 * `classeur` et `verrou`, rendent injectables le classeur du plan et le verrou.
 * Leurs défauts sont ceux de la v0.1.1 — classeur actif, verrou de document —,
 * si bien qu'un projet lié au classeur ne voit aucune différence. Un projet
 * autonome, où `getActive()` et `getDocumentLock()` rendent null, fournit les
 * siens : `SpreadsheetApp.openById(…)` et `LockService.getUserLock()`.
 *
 * Convention de forme : les points d'entrée du projet hôte sont des `function`
 * déclarées — l'éditeur ne propose qu'elles au menu d'exécution, et un
 * déclencheur ne sait viser que celles-là — tandis que tout l'interne est
 * écrit en `const nom_ = (…) => …`, invisible de ce menu.
 */

/**
 * Version du module — seul endroit du code qui la porte, et le banc d'essai
 * vérifie qu'elle vaut le fichier VERSION du dépôt.
 *
 * Elle survit à la recopie dans un projet hôte : c'est ainsi qu'on saura
 * quelle génération du motif y tourne, indépendamment de la version de l'hôte.
 */
const PPA_VERSION_ = '0.1.1-rangement.1';

/**
 * Les sept états d'une ligne de plan, écrits tels quels dans l'onglet.
 *
 * Ce que lit le code est exactement ce que lit l'humain : un état encodé
 * (« 2 », « OK ») obligerait à tenir une table de correspondance quelque part,
 * et personne ne la lirait au moment où le plan est justement là pour être lu.
 */
const PPA_ETATS_ = {
  aFaire: 'À faire',
  enCours: 'En cours',
  fait: 'Fait',
  aReprendre: 'À reprendre',
  aVerifier: 'À vérifier',
  abandonne: 'Abandonné',
  echec: 'Échec',
};

/** Les états depuis lesquels une ligne validée reste à traiter. */
const PPA_ETATS_EN_ATTENTE_ = ['', PPA_ETATS_.aFaire, PPA_ETATS_.enCours, PPA_ETATS_.aReprendre];

/** Les états qui prouvent qu'une ligne a déjà été engagée : préparer à nouveau les écraserait. */
const PPA_ETATS_ENGAGES_ = [
  PPA_ETATS_.enCours, PPA_ETATS_.fait, PPA_ETATS_.aVerifier,
  PPA_ETATS_.abandonne, PPA_ETATS_.echec,
];

const PPA_COLONNE_VALIDER_ = 'Valider';
const PPA_COLONNE_ETAT_ = 'État';
const PPA_COLONNE_DEPARTS_ = 'Départs';
const PPA_COLONNE_DETAIL_ = 'Détail';
const PPA_COLONNE_HORODATAGE_ = 'Horodatage';

/** Colonnes tenues par le module. Le plan en porte d'autres, qui sont celles du métier. */
const PPA_COLONNES_SERVICE_ = [
  PPA_COLONNE_ETAT_, PPA_COLONNE_DEPARTS_, PPA_COLONNE_DETAIL_, PPA_COLONNE_HORODATAGE_,
];

const PPA_DEFAUTS_ = {
  /**
   * Budget d'une exécution, sous le plafond de six minutes qui vaut pour tous
   * les types de compte — les trente minutes qu'on cite encore pour Workspace
   * ont été retirées. Quatre minutes laissent de quoi écrire l'état, poser le
   * déclencheur de reprise et rendre la main proprement.
   */
  budgetMs: 4 * 60 * 1000,

  /**
   * Durée à réserver pour une unité avant de la démarrer. On ne lance pas une
   * unité sur un budget entamé : le pari coûte l'exécution entière, et la
   * suivante repartira avec ses six minutes.
   */
  dureeUniteMs: 30 * 1000,

  departsMax: 3,
  delaiRepriseMs: 60 * 1000,

  /**
   * Ce qu'on fait d'une ligne retrouvée « En cours », c'est-à-dire d'une unité
   * dont l'exécution précédente a été tuée entre l'action et l'écriture.
   *
   * `verifier` (défaut) la sort de la file et la donne à relire : c'est le
   * seul choix tenable quand l'action est irréversible, puisque personne ne
   * peut savoir si le courriel est parti. `rejouer` la remet dans la file,
   * pour une action idempotente — et c'est alors le compteur de départs qui
   * borne les dégâts.
   */
  surInterruption: 'verifier',
};

/**
 * Limite de déclencheurs par utilisateur et par script (page des quotas Apps
 * Script). Un déclencheur ponctuel s'exécute une fois mais **reste inscrit au
 * projet** : une exécution tuée laisse le sien derrière elle, et l'on atteint
 * la limite sans jamais l'avoir vue venir.
 */
const PPA_DECLENCHEURS_MAX_ = 20;

/** Longueur retenue pour la colonne Détail : au-delà, la colonne ne se lit plus. */
const PPA_DETAIL_MAX_ = 480;

// ---------------------------------------------------------------------------
// Lecture et écriture du plan
// ---------------------------------------------------------------------------

const ppaClasseur_ = (definition) => {
  const classeur = typeof definition.classeur === 'function'
    ? definition.classeur() : SpreadsheetApp.getActive();
  if (!classeur) {
    throw new Error(
      'Aucun classeur pour le plan : ce script n\'est lié à aucun classeur, et la définition '
      + 'ne fournit pas « classeur ». Fournissez classeur: () => SpreadsheetApp.openById(…).');
  }
  return classeur;
};

const ppaFeuille_ = (definition, nomOnglet) => {
  const feuille = ppaClasseur_(definition).getSheetByName(nomOnglet);
  if (!feuille) {
    throw new Error(`L'onglet « ${nomOnglet} » n'existe pas. Préparez le plan avant de l'appliquer.`);
  }
  return feuille;
};

/**
 * Index en-tête → position, pour retrouver les colonnes par leur nom.
 *
 * Jamais par indice en dur : l'ordre des colonnes change, et une colonne
 * insérée à la main par l'utilisateur ne doit décaler aucune écriture.
 */
const ppaIndexColonnes_ = (entete) => {
  const index = {};
  entete.forEach((titre, position) => {
    const nom = String(titre ?? '').trim();
    if (nom !== '' && !(nom in index)) index[nom] = position;
  });
  return index;
};

const ppaVerifierColonnes_ = (index, nomOnglet) => {
  const manquantes = [PPA_COLONNE_VALIDER_, ...PPA_COLONNES_SERVICE_]
    .filter((nom) => !(nom in index));
  if (manquantes.length > 0) {
    throw new Error(
      `L'onglet « ${nomOnglet} » ne porte pas les colonnes ${manquantes.join(', ')}. `
      + 'Ce n\'est pas un plan : préparez-le, ou renommez cet onglet.');
  }
};

/**
 * Rend toujours `yyyy-MM-dd HH:mm:ss`, quelle que soit la forme rendue par la
 * cellule.
 *
 * Sheets rend un objet `Date` là où l'on avait écrit une chaîne : `String(…)`
 * donnerait « Thu May 14 2026 02:00:00 GMT+0200 ». L'affichage en anglais
 * n'est que le symptôme — le vrai défaut est que ces chaînes se comparent
 * alphabétiquement, sur le nom du jour. La normalisation se fait donc **à la
 * lecture**, jamais à l'écriture : on ne maîtrise pas ce que Sheets fait d'une
 * valeur en la stockant.
 */
const ppaNormaliserHorodatage_ = (valeur) => {
  if (valeur === '' || valeur === null || valeur === undefined) return '';
  if (valeur instanceof Date) {
    return Utilities.formatDate(valeur, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
  }
  return String(valeur);
};

const ppaHorodatage_ = () => Utilities.formatDate(
  new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');

/**
 * Lit l'onglet en un plan exploitable : l'en-tête, son index, et une ligne par
 * unité de travail.
 *
 * Une seule lecture en bloc — jamais cellule par cellule — et l'objet rendu
 * garde la feuille, pour que les écritures suivantes n'aient pas à la
 * retrouver.
 */
const ppaLirePlan_ = (definition) => {
  const nomOnglet = definition.onglet;
  const feuille = ppaFeuille_(definition, nomOnglet);
  const hauteur = feuille.getLastRow();
  const largeur = feuille.getLastColumn();
  if (hauteur < 1 || largeur < 1) {
    throw new Error(`L'onglet « ${nomOnglet} » est vide. Préparez le plan avant de l'appliquer.`);
  }

  const valeurs = feuille.getRange(1, 1, hauteur, largeur).getValues();
  const index = ppaIndexColonnes_(valeurs[0]);
  ppaVerifierColonnes_(index, nomOnglet);

  const lignes = valeurs.slice(1).map((cellules, rang) => ({
    numero: rang + 2,
    cellules,
    // Une case à cocher rend un booléen. On n'accepte que `true` : une ligne
    // validée déclenche une action irréversible, ce n'est pas l'endroit où
    // interpréter « oui », « x » ou « 1 ».
    valide: cellules[index[PPA_COLONNE_VALIDER_]] === true,
    etat: String(cellules[index[PPA_COLONNE_ETAT_]] ?? '').trim(),
    departs: Number(cellules[index[PPA_COLONNE_DEPARTS_]]) || 0,
  }));

  return { feuille, index, lignes, onglet: nomOnglet };
};

const ppaEnAttente_ = (ligne) => PPA_ETATS_EN_ATTENTE_.includes(ligne.etat);

/**
 * Écrit l'état d'une ligne, puis force le vidage du tampon.
 *
 * Le `flush()` n'est pas une précaution de confort : une exécution qui atteint
 * le plafond des six minutes n'est pas interrompue, elle est **tuée**. Aucun
 * `catch`, aucun `finally`, aucune écriture de retour. Ce qui n'est pas parti
 * vers Sheets avant l'appel coûteux n'existe pas pour la reprise.
 *
 * Les colonnes de service sont contiguës, mais on écrit la plage min→max en
 * relisant d'abord ce qu'elle contient : une colonne que l'utilisateur aurait
 * glissée au milieu est ainsi préservée au lieu d'être écrasée.
 */
const ppaEcrireEtat_ = (plan, ligne, etat, options = {}) => {
  const positions = PPA_COLONNES_SERVICE_.map((nom) => plan.index[nom]);
  const debut = Math.min(...positions);
  const fin = Math.max(...positions);

  const plage = plan.feuille.getRange(ligne.numero, debut + 1, 1, fin - debut + 1);
  const valeurs = plage.getValues()[0];
  const poser = (nom, valeur) => { valeurs[plan.index[nom] - debut] = valeur; };

  poser(PPA_COLONNE_ETAT_, etat);
  if (options.departs !== undefined && options.departs !== null) {
    poser(PPA_COLONNE_DEPARTS_, options.departs);
  }
  if (options.detail !== undefined) {
    poser(PPA_COLONNE_DETAIL_, options.detail === null || options.detail === ''
      ? '' : String(options.detail).slice(0, PPA_DETAIL_MAX_));
  }
  poser(PPA_COLONNE_HORODATAGE_, ppaHorodatage_());

  plage.setValues([valeurs]);
  SpreadsheetApp.flush();

  // L'objet en mémoire suit l'onglet, pour que le bilan de fin de passage se
  // calcule sans relire le classeur.
  ligne.etat = etat;
  if (options.departs !== undefined && options.departs !== null) ligne.departs = options.departs;
};

/**
 * Ce que `appliquerUnite` reçoit : les colonnes du métier, par leur nom.
 *
 * Les colonnes de service n'y figurent pas — sauf le nombre de départs, qui
 * dit à l'appelant que cette unité a déjà été tentée. C'est la seule
 * information dont il a besoin pour se rendre idempotent s'il le peut.
 */
const ppaVue_ = (plan, ligne) => {
  const vue = { numeroDeLigne: ligne.numero, departs: ligne.departs };
  Object.keys(plan.index).forEach((nom) => {
    if (nom === PPA_COLONNE_VALIDER_ || PPA_COLONNES_SERVICE_.includes(nom)) return;
    vue[nom] = ligne.cellules[plan.index[nom]];
  });
  return vue;
};

// ---------------------------------------------------------------------------
// Déclencheurs de reprise
// ---------------------------------------------------------------------------

const ppaRetirerDeclencheurs_ = (nomFonction) => {
  let retires = 0;
  ScriptApp.getProjectTriggers().forEach((declencheur) => {
    if (declencheur.getHandlerFunction() === nomFonction) {
      ScriptApp.deleteTrigger(declencheur);
      retires += 1;
    }
  });
  return retires;
};

/**
 * Programme la reprise, après avoir ramassé les déclencheurs précédents.
 *
 * La cible doit être une `function` déclarée du projet : un déclencheur est
 * résolu par son nom global au moment où il se réveille, et rien ne signale
 * l'erreur avant. Vérifier ici coûte une ligne et évite de découvrir
 * « Fonction de script introuvable » dans un journal, une minute plus tard,
 * sans personne pour le lire.
 */
const ppaProgrammerReprise_ = (definition) => {
  ppaRetirerDeclencheurs_(definition.fonctionDeReprise);

  if (typeof globalThis !== 'undefined'
      && typeof globalThis[definition.fonctionDeReprise] !== 'function') {
    throw new Error(
      `La reprise vise « ${definition.fonctionDeReprise} », qui n'est pas une function `
      + 'déclarée de ce projet. Un déclencheur qui la viserait échouerait une minute '
      + 'plus tard, en arrière-plan, sur « Fonction de script introuvable ».');
  }

  const existants = ScriptApp.getProjectTriggers().length;
  if (existants >= PPA_DECLENCHEURS_MAX_) {
    throw new Error(
      `Impossible de programmer la reprise : ce projet compte déjà ${existants} `
      + `déclencheurs sur les ${PPA_DECLENCHEURS_MAX_} autorisés par utilisateur et par `
      + 'script. Supprimez-en avant de relancer.');
  }

  ScriptApp.newTrigger(definition.fonctionDeReprise)
    .timeBased()
    .after(definition.delaiRepriseMs)
    .create();
};

// ---------------------------------------------------------------------------
// Préparer
// ---------------------------------------------------------------------------

const ppaEnteteComplete_ = (definition) => [
  PPA_COLONNE_VALIDER_, ...definition.colonnes, ...PPA_COLONNES_SERVICE_,
];

/**
 * Écrit le plan dans son onglet et rend le nombre de lignes posées.
 *
 * Refuse d'écraser un plan dont des lignes sont déjà engagées : ce serait
 * perdre la trace de ce qui a été fait, c'est-à-dire exactement ce que ce
 * module existe pour ne pas perdre. `{ remplacer: true }` lève le refus, et
 * c'est à l'appelant de demander confirmation avant.
 */
const ppaPreparer_ = (definition, optionsRecues) => {
  // Un paramètre par défaut ne se déclenche que sur `undefined` : un appelant
  // qui passe explicitement `null` — ce que fait n'importe quel code qui
  // transmet une option absente — obtiendrait sinon un « Cannot read
  // properties of null ». Attrapé par le banc, pas en production.
  const options = optionsRecues || {};
  const classeur = ppaClasseur_(definition);
  let feuille = classeur.getSheetByName(definition.onglet);

  if (feuille && feuille.getLastRow() > 1) {
    const plan = ppaLirePlan_(definition);
    const engagees = plan.lignes.filter((l) => PPA_ETATS_ENGAGES_.includes(l.etat)).length;
    if (engagees > 0 && !options.remplacer) {
      throw new Error(
        `Le plan « ${definition.onglet} » porte déjà ${engagees} ligne(s) engagée(s). `
        + 'Le remplacer effacerait la trace de ce qui a été fait.');
    }
  }

  const lignes = definition.construirePlan();
  if (!Array.isArray(lignes)) {
    throw new Error('construirePlan doit rendre un tableau de lignes.');
  }

  if (!feuille) feuille = classeur.insertSheet(definition.onglet);
  else feuille.clear();

  const entete = ppaEnteteComplete_(definition);
  const corps = lignes.map((ligne) => [
    false,
    ...definition.colonnes.map((nom) => {
      const valeur = ligne[nom];
      return valeur === undefined || valeur === null ? '' : valeur;
    }),
    PPA_ETATS_.aFaire, 0, '', '',
  ]);

  // Une seule écriture pour tout le bloc : jamais cellule par cellule.
  feuille.getRange(1, 1, 1, entete.length).setValues([entete]).setFontWeight('bold');
  if (corps.length > 0) {
    feuille.getRange(2, 1, corps.length, entete.length).setValues(corps);
    feuille.getRange(2, 1, corps.length, 1)
      .setDataValidation(SpreadsheetApp.newDataValidation().requireCheckbox().build());
  }
  feuille.setFrozenRows(1);

  return { lignes: corps.length, onglet: definition.onglet };
};

// ---------------------------------------------------------------------------
// Appliquer
// ---------------------------------------------------------------------------

const ppaEstTransitoire_ = (definition, erreur) => {
  if (typeof definition.estTransitoire === 'function') {
    return definition.estTransitoire(erreur) === true;
  }
  return false;
};

/**
 * Traite les lignes restées « En cours », c'est-à-dire les unités dont
 * l'exécution précédente a été tuée entre l'action et l'écriture de l'état.
 *
 * C'est la fenêtre dangereuse, et elle ne se referme pas : le module garantit
 * « au moins une fois », jamais « exactement une fois ». Sous la politique
 * `verifier`, la ligne sort de la file et attend un humain — pour un courriel
 * parti ou non, c'est le seul verdict honnête. Sous `rejouer`, elle reste en
 * file et le compteur de départs borne les dégâts.
 */
const ppaTraiterInterruptions_ = (plan, definition) => {
  if (definition.surInterruption !== 'verifier') return 0;
  let sorties = 0;
  plan.lignes
    .filter((ligne) => ligne.valide && ligne.etat === PPA_ETATS_.enCours)
    .forEach((ligne) => {
      ppaEcrireEtat_(plan, ligne, PPA_ETATS_.aVerifier, {
        detail: `Exécution interrompue au départ n° ${ligne.departs} : impossible de savoir `
          + 'si l\'action a abouti. À vérifier, puis remettre la ligne « À faire » ou « Fait ».',
      });
      sorties += 1;
    });
  return sorties;
};

const ppaCompterEtats_ = (lignes) => {
  const compte = {};
  Object.values(PPA_ETATS_).forEach((etat) => { compte[etat] = 0; });
  lignes.forEach((ligne) => {
    const etat = ligne.etat === '' ? PPA_ETATS_.aFaire : ligne.etat;
    compte[etat] = (compte[etat] || 0) + 1;
  });
  return compte;
};

/**
 * Applique les lignes validées, dans la limite du budget et du quota.
 *
 * Deux exécutions sur le même classeur, c'est une de trop : rien n'empêche
 * quelqu'un qui lit « en attente » de relancer depuis le menu pendant qu'un
 * déclencheur travaille. `getDocumentLock` et non `getScriptLock` — l'état
 * appartient à ce classeur, et deux classeurs n'ont aucune raison de
 * s'attendre. Attente nulle : celui qui arrive second n'a rien d'utile à
 * faire.
 */
const ppaAppliquer_ = (definition) => {
  const verrou = typeof definition.verrou === 'function'
    ? definition.verrou() : LockService.getDocumentLock();
  // `getDocumentLock` rend **null**, sans rien lever, dans un projet autonome.
  // Sans ce contrôle, l'appel suivant produit « Cannot read properties of null
  // (reading 'tryLock') » — un message qui n'apprend rien et qui masque la
  // vraie cause, laquelle se corrige en une minute quand on la connaît.
  if (!verrou) {
    throw new Error(
      'PlanPuisApplication a besoin d\'un verrou de document, et ce script n\'est pas '
      + 'lié à un classeur : LockService.getDocumentLock() rend null dans un projet '
      + 'autonome. Le plan vit dans un onglet — ce module s\'emploie depuis un script '
      + 'lié au classeur (Extensions > Apps Script depuis la feuille de calcul).');
  }
  if (!verrou.tryLock(0)) {
    return {
      refus: 'verrou',
      message: 'Une application est déjà en cours sur ce classeur. Rien n\'a été fait.',
      traitees: 0,
    };
  }

  try {
    const plan = ppaLirePlan_(definition);
    const aVerifier = ppaTraiterInterruptions_(plan, definition);
    const file = plan.lignes.filter((ligne) => ligne.valide && ppaEnAttente_(ligne));

    // Le quota se lit avant de commencer, plutôt que d'échouer à mi-parcours.
    const quota = typeof definition.quotaDisponible === 'function'
      ? Number(definition.quotaDisponible()) : Infinity;
    if (file.length > 0 && quota <= 0) {
      return {
        refus: 'quota',
        message: 'Le quota du jour est épuisé : aucune unité n\'a été traitée.',
        traitees: 0, restant: file.length, aVerifier,
      };
    }

    const debut = Date.now();
    let traitees = 0;
    let arret = null;

    for (const ligne of file) {
      if (traitees >= quota) { arret = 'quota'; break; }
      if (Date.now() - debut + definition.dureeUniteMs > definition.budgetMs) {
        arret = 'budget';
        break;
      }

      const departs = ligne.departs + 1;
      if (departs > definition.departsMax) {
        ppaEcrireEtat_(plan, ligne, PPA_ETATS_.abandonne, {
          detail: `Abandonnée après ${definition.departsMax} départs sans arrivée.`,
        });
        continue;
      }

      // Le départ est écrit AVANT l'appel coûteux. C'est le seul parachute
      // possible contre la boucle : une tentative enregistrée avant l'étape
      // survit à la mort du processus, un compteur d'erreurs non.
      ppaEcrireEtat_(plan, ligne, PPA_ETATS_.enCours, { departs, detail: '' });

      let resultat = null;
      let erreur = null;
      try {
        resultat = definition.appliquerUnite(ppaVue_(plan, ligne));
      } catch (e) {
        erreur = e;
      }

      if (!erreur) {
        ppaEcrireEtat_(plan, ligne, PPA_ETATS_.fait, { departs, detail: resultat ?? '' });
        traitees += 1;
      } else if (ppaEstTransitoire_(definition, erreur)) {
        // Rejouée à la reprise, pas dans la foulée : rejouer aussitôt une
        // erreur passagère, c'est surtout la rejouer pendant qu'elle dure.
        ppaEcrireEtat_(plan, ligne, PPA_ETATS_.aReprendre, {
          departs, detail: `Erreur passagère : ${erreur.message}`,
        });
      } else {
        ppaEcrireEtat_(plan, ligne, PPA_ETATS_.echec, { departs, detail: erreur.message });
      }
    }

    const restant = plan.lignes.filter((l) => l.valide && ppaEnAttente_(l)).length;

    if (restant > 0 && arret !== 'quota') {
      ppaProgrammerReprise_(definition);
    } else {
      // Fin de file : le déclencheur ponctuel ne se ramasse pas tout seul.
      ppaRetirerDeclencheurs_(definition.fonctionDeReprise);
    }

    const bilan = {
      traitees,
      restant,
      aVerifier,
      arret,
      reprisePrevue: restant > 0 && arret !== 'quota',
      parEtat: ppaCompterEtats_(plan.lignes),
      onglet: definition.onglet,
    };

    // La clôture ne se déclenche que si ce passage a fait quelque chose : sans
    // cela, un second clic sur un plan déjà appliqué la rejouerait.
    if (traitees > 0 && restant === 0 && typeof definition.cloture === 'function') {
      definition.cloture(bilan);
    }

    return bilan;
  } finally {
    verrou.releaseLock();
  }
};

// ---------------------------------------------------------------------------
// Oublier l'état, et le lire
// ---------------------------------------------------------------------------

/**
 * Repartir de zéro : retire les déclencheurs et remet en file ce qui y était.
 *
 * Reprendre au même endroit est le bon comportement tant que la cause est
 * passagère ; quand elle ne l'est pas, ce même curseur rejoue l'échec chaque
 * matin. D'où ce levier — qui n'efface que l'état, jamais une ligne.
 *
 * Ne touche ni à « Fait », ni à « À vérifier », ni à « Échec » : les deux
 * premiers parce qu'une action peut être partie, le troisième parce qu'il
 * nomme une cause qui n'a pas disparu. Ces lignes-là se modifient à la main,
 * dans l'onglet, ce qui est précisément l'intérêt d'avoir mis l'état dans un
 * tableur.
 */
const ppaOublier_ = (definition) => {
  const declencheurs = ppaRetirerDeclencheurs_(definition.fonctionDeReprise);
  const plan = ppaLirePlan_(definition);
  const remises = plan.lignes.filter((ligne) => [
    PPA_ETATS_.enCours, PPA_ETATS_.aReprendre, PPA_ETATS_.abandonne,
  ].includes(ligne.etat));

  remises.forEach((ligne) => {
    ppaEcrireEtat_(plan, ligne, PPA_ETATS_.aFaire, { departs: 0, detail: '' });
  });

  return { declencheurs, remises: remises.length, parEtat: ppaCompterEtats_(plan.lignes) };
};

const ppaBilan_ = (definition) => {
  const plan = ppaLirePlan_(definition);
  const validees = plan.lignes.filter((ligne) => ligne.valide);
  return {
    onglet: definition.onglet,
    lignes: plan.lignes.length,
    validees: validees.length,
    aTraiter: validees.filter((ligne) => ppaEnAttente_(ligne)).length,
    parEtat: ppaCompterEtats_(plan.lignes),
    reprisePrevue: ScriptApp.getProjectTriggers()
      .some((d) => d.getHandlerFunction() === definition.fonctionDeReprise),
  };
};

// ---------------------------------------------------------------------------
// Déclaration
// ---------------------------------------------------------------------------

/**
 * Vérifie la définition et applique les défauts.
 *
 * Refuse tout ce qui produirait un défaut silencieux plus tard : c'est le même
 * principe qu'un faux service de banc d'essai, qui doit refuser ce que le vrai
 * refuse. Une définition acceptée à tort se paie en production, sur une
 * opération irréversible.
 */
const ppaValiderDefinition_ = (definition) => {
  if (!definition || typeof definition !== 'object') {
    throw new Error('PlanPuisApplication.declarer attend un objet de définition.');
  }

  ['cle', 'onglet', 'fonctionDeReprise'].forEach((champ) => {
    if (typeof definition[champ] !== 'string' || definition[champ].trim() === '') {
      throw new Error(`PlanPuisApplication.declarer : « ${champ} » est obligatoire.`);
    }
  });

  ['construirePlan', 'appliquerUnite'].forEach((champ) => {
    if (typeof definition[champ] !== 'function') {
      throw new Error(`PlanPuisApplication.declarer : « ${champ} » doit être une fonction.`);
    }
  });

  ['classeur', 'verrou'].forEach((champ) => {
    if (definition[champ] !== undefined && typeof definition[champ] !== 'function') {
      throw new Error(`PlanPuisApplication.declarer : « ${champ} », s'il est fourni, doit être une fonction.`);
    }
  });

  if (!Array.isArray(definition.colonnes) || definition.colonnes.length === 0) {
    throw new Error('PlanPuisApplication.declarer : « colonnes » doit nommer au moins une colonne.');
  }

  const reservees = [PPA_COLONNE_VALIDER_, ...PPA_COLONNES_SERVICE_];
  const collision = definition.colonnes.find((nom) => reservees.includes(String(nom).trim()));
  if (collision) {
    throw new Error(
      `PlanPuisApplication.declarer : la colonne « ${collision} » porte le nom d'une colonne `
      + `du module (${reservees.join(', ')}). Renommez-la.`);
  }

  const doublon = definition.colonnes.find(
    (nom, i) => definition.colonnes.indexOf(nom) !== i);
  if (doublon) {
    throw new Error(
      `PlanPuisApplication.declarer : la colonne « ${doublon} » est déclarée deux fois. `
      + 'Les colonnes sont retrouvées par leur nom, un doublon en rendrait une inatteignable.');
  }

  const surInterruption = definition.surInterruption ?? PPA_DEFAUTS_.surInterruption;
  if (!['verifier', 'rejouer'].includes(surInterruption)) {
    throw new Error(
      `PlanPuisApplication.declarer : « surInterruption » vaut « ${surInterruption} », `
      + 'attendu « verifier » ou « rejouer ».');
  }

  const complet = { ...PPA_DEFAUTS_, ...definition, surInterruption };

  if (complet.dureeUniteMs >= complet.budgetMs) {
    throw new Error(
      'PlanPuisApplication.declarer : la durée réservée à une unité '
      + `(${complet.dureeUniteMs} ms) atteint le budget de l'exécution `
      + `(${complet.budgetMs} ms) : aucune unité ne démarrerait jamais.`);
  }

  return complet;
};

/**
 * Le seul nom public du module.
 *
 * Long à dessein : ce fichier est recopié dans des projets qui ont leurs
 * propres constantes globales, et une collision de noms empêche le projet
 * entier de se charger.
 */
const PlanPuisApplication = {
  version: PPA_VERSION_,
  etats: PPA_ETATS_,

  declarer: (definition) => {
    const complete = ppaValiderDefinition_(definition);
    return {
      cle: complete.cle,
      onglet: complete.onglet,
      version: PPA_VERSION_,

      /** Construit le plan et l'écrit dans son onglet. */
      preparer: (options) => ppaPreparer_(complete, options),

      /** Applique les lignes validées. Ne parle jamais à l'interface. */
      appliquer: () => ppaAppliquer_(complete),

      /**
       * Cible du déclencheur de reprise. Retire ses propres déclencheurs en
       * toute première ligne : c'est le seul ramassage qui opère quand
       * l'application renonce aussitôt, verrou déjà pris.
       */
      reprendre: () => {
        ppaRetirerDeclencheurs_(complete.fonctionDeReprise);
        return ppaAppliquer_(complete);
      },

      oublierEtat: () => ppaOublier_(complete),
      bilan: () => ppaBilan_(complete),
    };
  },
};
