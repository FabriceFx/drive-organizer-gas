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
 *     dans le magasin partagé se verrait.
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

const construireSandbox = (options = {}) => {
  const fichiers = options.fichiers || [];
  const drivesPartages = options.drivesPartages || [];
  const magasins = { script: new Map(), user: new Map(), document: new Map() };
  const appels = { list: [], fetch: [], permissions: [] };
  const reponsesFetch = [...(options.reponsesFetch || [])];

  const magasin = (nom) => ({
    getProperty: (cle) => (magasins[nom].has(cle) ? magasins[nom].get(cle) : null),
    setProperty: (cle, valeur) => { magasins[nom].set(cle, String(valeur)); },
    deleteProperty: (cle) => { magasins[nom].delete(cle); },
  });

  const Drive = {
    About: {
      get: (params) => {
        if (!params || !params.fields) throw new Error('Drive.About.get : « fields » est obligatoire.');
        return { user: { emailAddress: options.adresse || 'moi@exemple.fr', displayName: 'Camille Essai' } };
      },
    },
    Files: {
      get: (id, params) => {
        if (id === 'root') return { id: options.racineId || 'racine' };
        const f = fichiers.find((x) => x.id === id);
        if (!f) throw new Error(`File not found: ${id}.`);
        return restreindre(f, (params && params.fields ? params.fields : 'id').split(','));
      },
      list: (params) => {
        appels.list.push(params);
        if (params.corpora && !CORPORA.includes(params.corpora)) throw new Error('Invalid Value');
        if (params.corpora === 'drive' && !params.driveId) {
          throw new Error('The driveId parameter must be specified if and only if corpora is set to drive.');
        }
        const taille = Math.min(Number(params.pageSize) || 100, 1000);
        const debut = params.pageToken ? Number(String(params.pageToken).replace('page-', '')) : 0;
        if (params.pageToken && (!/^page-\d+$/.test(params.pageToken) || debut >= fichiers.length)) {
          throw new Error('Invalid Value');
        }
        const selection = lireSelection(params.fields);
        const champsFichier = selection.sous.files || new Set(['id', 'name', 'mimeType', 'kind']);
        const lot = fichiers.slice(debut, debut + taille).map((f) => restreindre(f, champsFichier));
        const suite = debut + taille < fichiers.length ? `page-${debut + taille}` : undefined;
        const reponse = { files: lot };
        if (suite && (!params.fields || selection.racine.has('nextPageToken'))) reponse.nextPageToken = suite;
        return reponse;
      },
    },
    Drives: {
      list: (params) => ({ drives: drivesPartages.map((d) => ({ id: d.id, name: d.name })), ...(params ? {} : {}) }),
    },
    Permissions: {
      list: (id, params) => {
        appels.permissions.push({ id, params });
        const drive = drivesPartages.find((d) => d.id === id);
        if (drive && !(params && params.supportsAllDrives)) throw new Error(`File not found: ${id}.`);
        if (drive && drive.illisible) throw new Error('The user does not have sufficient permissions for this file.');
        return { permissions: drive ? drive.permissions : [] };
      },
    },
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
      throw new Error(`Motif de date non simulé : ${motif}`);
    },
    sleep: () => {},
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
    Drive,
    Utilities,
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

  return { sandbox, magasins, appels };
};

module.exports = { construireSandbox, lireSelection };
