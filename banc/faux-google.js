/**
 * Banc d'essai — simulateurs des services Google.
 *
 * **Un faux service complaisant valide du code faux.** Ceux-ci refusent ce que
 * les vrais refusent, et ne rendent que ce que les vrais rendent :
 *
 *   - `Drive.Files.list` ne rend **que les champs demandés** dans `fields`. Un
 *     champ oublié dans la liste arrive `undefined`, exactement comme chez
 *     Google — c'est le défaut le plus facile à commettre et le plus
 *     silencieux : l'analyse le lirait « non mesuré » partout ;
 *   - `corpora` n'accepte que les quatre valeurs documentées, et `drive` exige
 *     `driveId` ;
 *   - un jeton de page inconnu lève « Invalid Value » ;
 *   - `Drive.Permissions.list` sur un Drive partagé, sans `supportsAllDrives`,
 *     lève « File not found », comme le vrai ;
 *   - `Utilities.formatDate` applique réellement le fuseau demandé : un
 *     horodatage UTC de 22 h 30 est le lendemain à Paris ;
 *   - trois magasins de propriétés distincts : un réglage personnel écrit
 *     dans le magasin partagé se verrait ;
 *   - (v0.2) déplacer un dossier vers un Drive partagé lève
 *     « Moving folders into shared drives is not supported », et donner un
 *     second parent lève, comme chez Google depuis le passage au parent unique ;
 *   - un jeton de création de Drive déjà servi lève au lieu de créer un
 *     doublon ; les recherches `q` non simulées lèvent au lieu de tout rendre ;
 *   - le faux classeur tamponne les écritures jusqu'au `flush`, et sait
 *     « tuer » l'exécution à un vidage donné : ce qui n'était pas parti est
 *     perdu, et le processus mort le reste — tout appel suivant lève.
 */

'use strict';

const CORPORA = ['user', 'domain', 'drive', 'allDrives'];

/**
 * Noms de premier niveau d'une sélection `fields` de l'API :
 * « nextPageToken, files(id,owners(emailAddress)) » → nextPageToken, et pour
 * files : id, owners.
 */
const lireSelection = (fields) => {
  const texte = String(fields || '');
  const racine = new Set();
  const sous = {};
  let i = 0;
  const lireNom = () => {
    let nom = '';
    while (i < texte.length && !',()'.includes(texte[i])) nom += texte[i++];
    return nom.trim();
  };
  const sauterGroupe = () => {
    let niveau = 0;
    do {
      if (texte[i] === '(') niveau += 1;
      else if (texte[i] === ')') niveau -= 1;
      i += 1;
    } while (i < texte.length && niveau > 0);
  };
  while (i < texte.length) {
    const nom = lireNom();
    if (texte[i] === '(') {
      racine.add(nom);
      sous[nom] = new Set();
      i += 1;
      while (i < texte.length && texte[i] !== ')') {
        const champ = lireNom();
        if (champ) sous[nom].add(champ);
        if (texte[i] === '(') sauterGroupe();
        if (texte[i] === ',') i += 1;
      }
      i += 1;
    } else if (nom) racine.add(nom);
    if (texte[i] === ',') i += 1;
  }
  return { racine, sous };
};

const restreindre = (objet, champs) => {
  const resultat = {};
  champs.forEach((champ) => { if (objet[champ] !== undefined) resultat[champ] = objet[champ]; });
  return resultat;
};

const MIME_DOSSIER = 'application/vnd.google-apps.folder';
const ROLES_PERMIS = ['owner', 'organizer', 'fileOrganizer', 'writer', 'commenter', 'reader'];
const TYPES_PERMIS = ['user', 'group', 'domain', 'anyone'];

/** L'erreur que lève le faux classeur quand le banc « tue » l'exécution à un flush donné. */
const TUEE = new Error('Exécution tuée (simulée par le banc)');

/* --------------------------------------------------------------------------
 * Classeur — tampon d'écriture, mort simulée, conversions de Sheets
 * ----------------------------------------------------------------------- */

/**
 * Ce que Sheets fait d'une valeur en la stockant :
 *   - « 'texte » : l'apostrophe force le texte, et disparaît de la valeur ;
 *   - « =… » : devient une formule — le banc la consigne, pour vérifier
 *     qu'aucun nom de fichier n'en devient une ;
 *   - un nombre écrit en texte redevient un nombre, « TRUE » un booléen ;
 *   - « 2026-09-27 » ou « 2026-09-27 10:00:00 » devient un objet Date.
 */
const fabriquerCoercion = (etatFaux) => (valeur) => {
  if (typeof valeur !== 'string') return valeur;
  if (valeur.startsWith("'")) return valeur.slice(1);
  if (valeur.startsWith('=')) { etatFaux.formules.push(valeur); return valeur; }
  if (/^-?\d+(\.\d+)?$/.test(valeur)) return Number(valeur);
  if (/^(true|false)$/i.test(valeur)) return /^true$/i.test(valeur);
  const date = /^(\d{4})-(\d{2})-(\d{2})(?: (\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(valeur);
  if (date) {
    const [, a, m, j, h = '0', mi = '0', se = '0'] = date;
    return new etatFaux.Date(Number(a), Number(m) - 1, Number(j), Number(h), Number(mi), Number(se));
  }
  return valeur;
};

const fabriquerSheets = (etatFaux) => {
  const coercer = fabriquerCoercion(etatFaux);
  const tampon = { enAttente: [] };
  const classeurs = new Map();

  class FausseFeuille {
    constructor(nom) { this.nom = nom; this.cellules = []; this.masquees = new Set(); this.cases = new Set(); }
    getName() { return this.nom; }
    setName(nom) { this.nom = nom; return this; }
    lu(l, c) {
      for (let i = tampon.enAttente.length - 1; i >= 0; i -= 1) {
        const e = tampon.enAttente[i];
        if (e.feuille === this && e.l === l && e.c === c) return e.v;
      }
      const v = (this.cellules[l - 1] || [])[c - 1];
      return v === undefined ? '' : v;
    }
    getLastRow() {
      let n = this.cellules.length;
      tampon.enAttente.forEach((e) => { if (e.feuille === this) n = Math.max(n, e.l); });
      return n;
    }
    getLastColumn() {
      let n = this.cellules.reduce((m, r) => Math.max(m, r ? r.length : 0), 0);
      tampon.enAttente.forEach((e) => { if (e.feuille === this) n = Math.max(n, e.c); });
      return n;
    }
    getRange(ligne, colonne, hauteur = 1, largeur = 1) {
      if (![ligne, colonne, hauteur, largeur].every((n) => Number.isInteger(n) && n >= 1)) {
        throw new Error('The number of rows or columns in the range must be at least 1.');
      }
      const feuille = this;
      return {
        setValues(valeurs) {
          if (etatFaux.mort) throw TUEE;
          if (valeurs.length !== hauteur) throw new Error('The number of rows in the data does not match the number of rows in the range.');
          valeurs.forEach((rang, i) => {
            if (rang.length !== largeur) throw new Error('The number of columns in the data does not match the number of columns in the range.');
            rang.forEach((v, j) => tampon.enAttente.push({ feuille, l: ligne + i, c: colonne + j, v: coercer(v) }));
          });
          return this;
        },
        getValues() {
          if (etatFaux.mort) throw TUEE;
          return Array.from({ length: hauteur }, (_, i) => Array.from({ length: largeur }, (__, j) => feuille.lu(ligne + i, colonne + j)));
        },
        setValue(v) { return this.setValues([[v]]); },
        setFontWeight() { return this; },
        setDataValidation(regle) {
          if (regle && regle.caseACocher) for (let i = 0; i < hauteur; i += 1) feuille.cases.add(ligne + i);
          return this;
        },
      };
    }
    hideColumns(colonne, nombre = 1) {
      if (!Number.isInteger(colonne) || colonne < 1) throw new Error('Those columns are out of bounds.');
      for (let i = 0; i < nombre; i += 1) this.masquees.add(colonne + i);
    }
    setFrozenRows() { return this; }
    clear() { this.cellules = []; return this; }
    /** Pour le banc : cocher une case comme le ferait la personne (écriture commise). */
    cocher(ligne, colonne, valeur = true) {
      this.cellules[ligne - 1] = this.cellules[ligne - 1] || [];
      this.cellules[ligne - 1][colonne - 1] = valeur;
    }
  }

  class FauxClasseur {
    constructor(id, nom) { this.id = id; this.nom = nom; this.feuilles = [new FausseFeuille('Feuille 1')]; }
    getId() { return this.id; }
    getUrl() { return `https://docs.google.com/spreadsheets/d/${this.id}/edit`; }
    getSheets() { return this.feuilles; }
    getSheetByName(nom) { return this.feuilles.find((f) => f.nom === nom) || null; }
    insertSheet(nom) {
      if (this.getSheetByName(nom)) throw new Error(`A sheet with the name "${nom}" already exists. Please enter another name.`);
      const f = new FausseFeuille(nom);
      this.feuilles.push(f);
      return f;
    }
  }

  const flush = { compte: 0, tuerAu: null };
  const SpreadsheetApp = {
    create: (nom) => {
      if (!nom) throw new Error('Invalid argument: name');
      const id = `tableur${String(classeurs.size + 1).padStart(4, '0')}`;
      const c = new FauxClasseur(id, nom);
      classeurs.set(id, c);
      etatFaux.surCreationClasseur(c);
      return c;
    },
    openById: (id) => {
      if (!classeurs.has(id)) throw new Error(`Unexpected error while getting the method or property openById on object SpreadsheetApp.`);
      return classeurs.get(id);
    },
    getActive: () => null,
    newDataValidation: () => ({ requireCheckbox() { return this; }, build: () => ({ caseACocher: true }) }),
    flush: () => {
      if (etatFaux.mort) throw TUEE;
      flush.compte += 1;
      if (flush.tuerAu === flush.compte) {
        // Ce qui n'est pas parti vers Sheets avant la mort n'a jamais existé.
        // Et un processus tué le reste : aucun `catch` ne le ramène, tout
        // appel suivant lève de nouveau, jusqu'à ce que le banc simule une
        // nouvelle exécution (etatFaux.mort = false).
        tampon.enAttente = [];
        etatFaux.mort = true;
        throw TUEE;
      }
      tampon.enAttente.forEach((e) => {
        e.feuille.cellules[e.l - 1] = e.feuille.cellules[e.l - 1] || [];
        e.feuille.cellules[e.l - 1][e.c - 1] = e.v;
      });
      tampon.enAttente = [];
    },
  };
  return { SpreadsheetApp, classeurs, flush };
};

const construireSandbox = (options = {}) => {
  const fichiers = options.fichiers || [];
  const drivesPartages = options.drivesPartages || [];
  const magasins = { script: new Map(), user: new Map(), document: new Map() };
  const appels = { list: [], fetch: [], permissions: [] };
  const reponsesFetch = [...(options.reponsesFetch || [])];
  const adresse = options.adresse || 'moi@exemple.fr';
  const racineId = options.racineId || 'racine';

  // Ce que le banc observe des écritures dans Drive.
  const ecritures = { dossiersCrees: [], deplacements: [], metadonnees: [], drivesCrees: [], membresAjoutes: [] };
  let compteurId = 0;
  const nouvelId = (prefixe) => `${prefixe}${String((compteurId += 1)).padStart(6, '0')}`;

  const etatFaux = {
    mort: false,
    Date,          // remplacé par le Date du bac à sable, une fois le contexte créé
    formules: [],
    // Un classeur créé par SpreadsheetApp est aussi un fichier Drive, à la racine.
    surCreationClasseur: (c) => fichiers.push({
      id: c.getId(), name: c.nom, mimeType: 'application/vnd.google-apps.spreadsheet',
      parents: [racineId], ownedByMe: true, trashed: false,
    }),
  };
  const sheets = fabriquerSheets(etatFaux);

  const magasin = (nom) => ({
    getProperty: (cle) => (magasins[nom].has(cle) ? magasins[nom].get(cle) : null),
    setProperty: (cle, valeur) => { magasins[nom].set(cle, String(valeur)); },
    deleteProperty: (cle) => { magasins[nom].delete(cle); },
  });

  const trouverDrive = (id) => drivesPartages.find((d) => d.id === id);

  /** Un élément de Drive ; sans supportsAllDrives, ceux des Drives partagés sont introuvables, comme chez Google. */
  const trouver = (id, params) => {
    const f = fichiers.find((x) => x.id === id);
    if (!f || (f.driveId && !(params && params.supportsAllDrives))) throw new Error(`File not found: ${id}.`);
    return f;
  };

  const REQUETE_DOSSIER = /^'([^']+)' in parents and name = '((?:[^'\\]|\\.)*)' and mimeType = '([^']+)' and trashed = false$/;

  const Drive = {
    About: {
      get: (params) => {
        if (!params || !params.fields) throw new Error('Drive.About.get : « fields » est obligatoire.');
        return { user: { emailAddress: adresse, displayName: 'Camille Essai' } };
      },
    },
    Files: {
      get: (id, params) => {
        if (id === 'root' || id === racineId) {
          return restreindre({ id: racineId, mimeType: MIME_DOSSIER, trashed: false },
            (params && params.fields ? params.fields : 'id').split(','));
        }
        const f = trouver(id, params);
        return restreindre(f, (params && params.fields ? params.fields : 'id').split(','));
      },
      list: (params) => {
        appels.list.push(params);
        if (params.corpora && !CORPORA.includes(params.corpora)) throw new Error('Invalid Value');
        if (params.corpora === 'drive' && !params.driveId) {
          throw new Error('The driveId parameter must be specified if and only if corpora is set to drive.');
        }
        const selection = lireSelection(params.fields);
        const champsFichier = selection.sous.files || new Set(['id', 'name', 'mimeType', 'kind']);
        if (params.q && params.q !== 'trashed = false') {
          // Seule forme de recherche employée par le projet ; toute autre est
          // refusée, pour qu'une requête mal construite se voie ici.
          const r = REQUETE_DOSSIER.exec(params.q);
          if (!r) throw new Error(`Invalid Value (requête non simulée : ${params.q})`);
          const nom = r[2].replace(/\\(.)/g, '$1');
          const trouves = fichiers.filter((f) => (f.parents || []).includes(r[1]) && f.name === nom
            && f.mimeType === r[3] && !f.trashed);
          return { files: trouves.slice(0, params.pageSize || 100).map((f) => restreindre(f, champsFichier)) };
        }
        const visibles = fichiers.filter((f) => !f.trashed && !f.driveId);
        const taille = Math.min(Number(params.pageSize) || 100, 1000);
        const debut = params.pageToken ? Number(String(params.pageToken).replace('page-', '')) : 0;
        if (params.pageToken && (!/^page-\d+$/.test(params.pageToken) || debut >= visibles.length)) {
          throw new Error('Invalid Value');
        }
        const lot = visibles.slice(debut, debut + taille).map((f) => restreindre(f, champsFichier));
        const suite = debut + taille < visibles.length ? `page-${debut + taille}` : undefined;
        const reponse = { files: lot };
        if (suite && (!params.fields || selection.racine.has('nextPageToken'))) reponse.nextPageToken = suite;
        return reponse;
      },
      create: (ressource, media, params) => {
        if (!ressource || !ressource.name) throw new Error('Invalid argument: resource.name');
        const parents = ressource.parents && ressource.parents.length ? ressource.parents : [racineId];
        const f = { id: nouvelId('dos'), name: ressource.name, mimeType: ressource.mimeType, parents: [...parents], ownedByMe: true, trashed: false };
        fichiers.push(f);
        ecritures.dossiersCrees.push({ id: f.id, name: f.name, parent: parents[0] });
        return restreindre(f, ((params && params.fields) || 'id').split(','));
      },
      update: (ressource, id, media, params = {}) => {
        if (ressource === undefined || ressource === null) throw new Error('Invalid argument: resource');
        if (Object.keys(ressource).length > 0) ecritures.metadonnees.push({ id, ressource });
        const f = trouver(id, params);
        let parents = [...(f.parents || [])];
        if (params.removeParents) {
          params.removeParents.split(',').forEach((p) => { parents = parents.filter((x) => x !== p); });
        }
        if (params.addParents) {
          const cible = params.addParents;
          const driveCible = trouverDrive(cible) ? cible : ((fichiers.find((x) => x.id === cible) || {}).driveId || '');
          if (!trouverDrive(cible) && !fichiers.some((x) => x.id === cible) && cible !== racineId) {
            throw new Error(`File not found: ${cible}.`);
          }
          if (driveCible) {
            if (f.mimeType === MIME_DOSSIER) throw new Error('Moving folders into shared drives is not supported.');
            if (!params.supportsAllDrives) throw new Error(`File not found: ${cible}.`);
            f.driveId = driveCible;
          }
          parents.push(cible);
        }
        if (parents.length > 1) throw new Error('Increasing the number of parents is not allowed.');
        ecritures.deplacements.push({ id, de: f.parents || [], vers: parents });
        f.parents = parents;
        return restreindre(f, ((params && params.fields) || 'id').split(','));
      },
    },
    Drives: {
      list: (params = {}) => {
        let liste = drivesPartages;
        if (params.q) {
          const r = /^name = '((?:[^'\\]|\\.)*)'$/.exec(params.q);
          if (!r) throw new Error('Invalid Value');
          liste = liste.filter((d) => d.name === r[1].replace(/\\(.)/g, '$1'));
        }
        return { drives: liste.map((d) => ({ id: d.id, name: d.name, createdTime: d.createdTime || '2020-01-01T00:00:00.000Z' })) };
      },
      get: (id) => {
        const d = trouverDrive(id);
        if (!d) throw new Error(`Shared drive not found: ${id}`);
        return { id: d.id, name: d.name };
      },
      create: (ressource, requestId) => {
        if (!requestId) throw new Error('Required parameter: requestId');
        if (options.creationDriveInterdite) throw new Error('The user does not have sufficient permissions for this file.');
        if (drivesPartages.some((d) => d.requestId === requestId)) {
          throw new Error('API call to drive.drives.create failed with error: A shared drive with this requestId already exists.');
        }
        const d = {
          id: nouvelId('drv'), name: ressource.name, requestId, createdTime: new Date().toISOString(),
          permissions: [{ type: 'user', role: 'organizer', emailAddress: adresse }],
        };
        drivesPartages.push(d);
        ecritures.drivesCrees.push({ id: d.id, name: d.name });
        return { id: d.id, name: d.name };
      },
    },
    Permissions: {
      list: (id, params) => {
        appels.permissions.push({ id, params });
        const drive = trouverDrive(id);
        if (drive && !(params && params.supportsAllDrives)) throw new Error(`File not found: ${id}.`);
        if (drive && drive.illisible) throw new Error('The user does not have sufficient permissions for this file.');
        return { permissions: drive ? drive.permissions : (trouver(id, params).permissions || []) };
      },
      create: (ressource, id, params = {}) => {
        const drive = trouverDrive(id);
        if (drive && !params.supportsAllDrives) throw new Error(`File not found: ${id}.`);
        if (!TYPES_PERMIS.includes(ressource.type)) throw new Error('Invalid Value: type');
        if (!ROLES_PERMIS.includes(ressource.role)) throw new Error('Invalid Value: role');
        const cible = drive || trouver(id, params);
        cible.permissions = cible.permissions || [];
        cible.permissions.push({ type: ressource.type, role: ressource.role, emailAddress: ressource.emailAddress });
        ecritures.membresAjoutes.push({ id, ressource, params });
        return { id: nouvelId('perm') };
      },
    },
  };

  // Un processus mort n'appelle plus Drive : chaque méthode le vérifie.
  const mortel = (service) => Object.fromEntries(Object.entries(service).map(([nom, valeur]) => [nom,
    typeof valeur === 'function'
      ? (...args) => { if (etatFaux.mort) throw TUEE; return valeur(...args); }
      : mortel(valeur)]));
  const DriveMortel = mortel(Drive);

  const verrouUtilisateur = { pris: !!options.verrouPris };
  const LockService = {
    getUserLock: () => ({
      tryLock: () => { if (verrouUtilisateur.pris) return false; verrouUtilisateur.pris = true; return true; },
      releaseLock: () => { verrouUtilisateur.pris = false; },
    }),
    // Projet autonome : Google rend null, il ne lève pas.
    getDocumentLock: () => null,
  };

  const declencheurs = [];
  const ScriptApp = {
    newTrigger: (nom) => {
      if (!nom) throw new Error('The function name cannot be null or empty.');
      return { timeBased: () => ({ after: (ms) => ({ create: () => { const d = { nom, ms }; declencheurs.push(d); return d; } }) }) };
    },
    getProjectTriggers: () => declencheurs.map((d) => ({ getHandlerFunction: () => d.nom, _d: d })),
    deleteTrigger: (h) => { const i = declencheurs.indexOf(h._d); if (i >= 0) declencheurs.splice(i, 1); },
  };

  const Utilities = {
    formatDate: (date, fuseau, motif) => {
      // Pas d'instanceof : une date créée dans le bac à sable n'est pas une Date de Node.
      if (!date || typeof date.getTime !== 'function' || Number.isNaN(date.getTime())) {
        throw new Error('Invalid argument: date');
      }
      const parties = {};
      new Intl.DateTimeFormat('en-CA', {
        timeZone: fuseau, year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
      }).formatToParts(new Date(date.getTime())).forEach((p) => { parties[p.type] = p.value; });
      const jour = `${parties.year}-${parties.month}-${parties.day}`;
      if (motif === 'yyyy-MM-dd') return jour;
      if (motif === 'yyyy-MM-dd HH:mm:ss') return `${jour} ${parties.hour}:${parties.minute}:${parties.second}`;
      if (motif === 'yyyy-MM-dd HH:mm') return `${jour} ${parties.hour}:${parties.minute}`;
      throw new Error(`Motif de date non simulé : ${motif}`);
    },
    sleep: () => {},
    getUuid: () => `uuid-${String((compteurId += 1)).padStart(6, '0')}`,
  };

  const UrlFetchApp = {
    fetch: (url, params) => {
      appels.fetch.push({ url, params });
      const suivante = reponsesFetch.shift();
      if (!suivante) throw new Error('Aucune réponse simulée pour UrlFetchApp.fetch');
      if (!params.muteHttpExceptions && suivante.code >= 400) {
        throw new Error(`Request failed for ${url} returned code ${suivante.code}`);
      }
      return {
        getResponseCode: () => suivante.code,
        getContentText: () => (typeof suivante.corps === 'string' ? suivante.corps : JSON.stringify(suivante.corps)),
      };
    },
  };

  const HtmlService = {
    // L'énumération réelle ne compte que ces deux valeurs.
    XFrameOptionsMode: Object.freeze({ ALLOWALL: 'ALLOWALL', DEFAULT: 'DEFAULT' }),
    createTemplateFromFile: (nom) => ({ evaluate: () => sortieHtml(nom) }),
    createHtmlOutputFromFile: (nom) => sortieHtml(nom),
  };
  const sortieHtml = (nom) => {
    const sortie = {
      nom, titre: '', meta: {}, xframe: null,
      setTitle: (t) => { sortie.titre = t; return sortie; },
      addMetaTag: (n, v) => { sortie.meta[n] = v; return sortie; },
      setXFrameOptionsMode: (mode) => {
        if (mode === undefined) throw new Error('Invalid argument: mode');
        sortie.xframe = mode;
        return sortie;
      },
      getContent: () => `<!-- ${nom} -->`,
    };
    return sortie;
  };

  const sandbox = {
    console: options.silencieux === false ? console : { log: () => {}, warn: () => {}, error: () => {} },
    Drive: DriveMortel,
    Utilities,
    SpreadsheetApp: sheets.SpreadsheetApp,
    LockService,
    ScriptApp,
    UrlFetchApp,
    HtmlService,
    Session: { getScriptTimeZone: () => 'Europe/Paris' },
    PropertiesService: {
      getScriptProperties: () => magasin('script'),
      getUserProperties: () => magasin('user'),
      // Projet autonome : Google rend null, il ne lève pas.
      getDocumentProperties: () => null,
    },
  };

  return { sandbox, magasins, appels, ecritures, etatFaux, sheets, declencheurs, fichiers, drivesPartages, verrouUtilisateur };
};

module.exports = { construireSandbox, lireSelection, TUEE };
