/**
 * Rangement Drive — aperçu de l'interface, hors de Google.
 *
 *     node banc/apercu.js        → écrit banc/apercu.html
 *
 * Assemble Index.html comme le ferait HtmlService (les scriptlets
 * `SocleWeb.inclure` sont résolus), et remplace `google.script.run` par un faux
 * qui sert un Drive fictif, désordonné à dessein. Sert à relire l'interface
 * dans un navigateur, en clair comme en sombre, sans rien déployer.
 *
 * Le fichier produit n'est pas versionné : il se régénère.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const SOURCES = path.join(__dirname, '..', 'apps-script');
const version = fs.readFileSync(path.join(__dirname, '..', 'VERSION'), 'utf8').trim();

/* ------------------------------------------------------------ Drive fictif */

const elements = [];
let compteur = 0;
const id = () => `demo${(compteur += 1)}`;
const jour = (decalage) => new Date(Date.UTC(2026, 8, 27) - decalage * 86400000).toISOString().slice(0, 10);
const ajouter = (nom, parent, champs = {}) => {
  const e = {
    id: id(), nom, genre: 'document', parent, aMoi: true, proprietaire: '', cree: jour(400),
    modifie: jour(20), vu: jour(3), octets: 20000 + (compteur % 97) * 1000, partage: false,
    modifiePar: 'moi', permissions: [], cible: '', ...champs,
  };
  elements.push(e);
  return e.id;
};
const dossier = (nom, parent, champs) => ajouter(nom, parent, { genre: 'dossier', octets: 0, ...champs });
const ecriture = (...adresses) => adresses.map((adresse) => ({ type: 'user', role: 'writer', adresse, domaine: '' }));

const R = 'racine';
['Note réunion', 'Scan0001.pdf', 'Scan0002.pdf', 'IMG_2231.jpg', 'Budget compta 2025.xlsx', 'Présentation client Dupont',
  'Document sans titre', 'Document sans titre (1)', 'Copie de Planning', 'Liste courses', 'Facture EDF.pdf',
  'Compte rendu 12/03/2025', 'Idées', 'Brouillon', 'Export (3).csv', 'Formation Excel', 'Contrat Dupont v2.docx',
  'Organigramme', 'Tableau de bord', 'Sans titre', 'Notes vrac', 'Planning équipe'].forEach((n) => ajouter(n, R));

const equipe = ecriture('lea.martin@exemple.fr', 'hugo.bernard@exemple.fr', 'ines.petit@exemple.fr');
const marketing = dossier('Marketing 2026', R, { permissions: equipe, partage: true });
for (let i = 0; i < 40; i += 1) {
  ajouter(`Campagne ${i}`, marketing, { modifiePar: i % 4 ? 'lea.martin@exemple.fr' : 'moi', aMoi: i % 5 !== 0, proprietaire: i % 5 ? '' : 'hugo.bernard@exemple.fr', modifie: jour(i) });
}
const salon = dossier('Marketing salon Lyon', R, { permissions: equipe, partage: true });
for (let i = 0; i < 12; i += 1) ajouter(`Stand ${i}`, salon, { modifiePar: 'ines.petit@exemple.fr', modifie: jour(40 + i) });

const client = dossier('Client Acme', R, {
  permissions: [...ecriture('paul.roux@exemple.fr'), { type: 'user', role: 'writer', adresse: 'j.doe@acme.com', domaine: '' }],
  partage: true,
});
for (let i = 0; i < 35; i += 1) {
  ajouter(`Livrable Acme ${i}`, client, { aMoi: false, proprietaire: 'j.doe@acme.com', modifiePar: 'j.doe@acme.com', modifie: jour(10 + i) });
}

const perso = dossier('Perso', R, { permissions: ecriture('conjoint@exemple.fr') });
['Impôts 2025.pdf', 'Mutuelle.pdf', 'Photos vacances'].forEach((n) => ajouter(n, perso));
dossier('Famille', R);

const compta = dossier('Compta', R);
const factures = dossier('Factures', compta);
for (let i = 0; i < 180; i += 1) ajouter(`Facture ${String(i).padStart(4, '0')}.pdf`, factures, { genre: 'pdf', modifie: jour(i * 2) });
ajouter('Bilan v1.xlsx', compta, { genre: 'tableur' });
ajouter('Bilan v2.xlsx', compta, { genre: 'tableur' });
ajouter('Bilan final.xlsx', compta, { genre: 'tableur' });
ajouter('Bilan final relu.xlsx', compta, { genre: 'tableur' });

const archives = dossier('Anciens projets', R);
const vieux = dossier('Refonte site 2019', archives);
for (let i = 0; i < 25; i += 1) ajouter(`Maquette ${i}`, vieux, { modifie: jour(2400 + i) });

let parent = R;
['Projets', 'En cours', 'Interne', 'RH', 'Recrutement', '2025', 'Candidats', 'Dev'].forEach((n) => { parent = dossier(n, parent); });
ajouter('CV Dupont.pdf', parent, { genre: 'pdf' });

const doublons = dossier('Divers', R);
ajouter('Charte graphique.pdf', doublons, { genre: 'pdf', octets: 482113 });
ajouter('Charte graphique.pdf', marketing, { genre: 'pdf', octets: 482113 });
dossier('Nouveau dossier', R);
const cr = dossier('Comptes rendus', R);
['2025-01-14 CoDir', '2025-02-11 CoDir', '11/03/2025 CoDir', 'CoDir 8 avril 2025'].forEach((n) => ajouter(n, cr));
ajouter('Vieux devis.pdf', '', { genre: 'pdf' });
ajouter('Présentation perdue', '');
ajouter('Doc partagé par un collègue', '', { aMoi: false, proprietaire: 'x@exemple.fr' });

const drives = [{
  id: 'dp-marketing', nom: 'Équipe Marketing',
  membres: [...equipe, { type: 'user', role: 'organizer', adresse: 'moi@exemple.fr', domaine: '' }],
}];

/* ------------------------------------------------------------ faux serveur */

const contexte = {
  version, adresse: 'moi@exemple.fr', nom: 'Camille Démo', racineId: R, domainesInternes: ['exemple.fr'],
  aujourdhui: '2026-09-27',
  reglages: {
    racineMax: 15, profondeurMax: 6, fourreToutMin: 150, dormantAnnees: 3, seuilDrivePartage: 50, seuilAExaminer: 35,
    motsPersonnels: 'perso, personnel, privé, famille, impôts, santé, médical, cv, photos, banque, maison, vacances',
  },
  reglagesParDefaut: {},
  ia: { disponible: true, modele: 'gemini-3.8-flash', dossiersMax: 400, quotaJour: 5, restantAujourdhui: 5 },
  absorptions: { total: 0, causes: [] },
};
contexte.reglagesParDefaut = { ...contexte.reglages };

const fauxServeur = `
<script>
(() => {
  const ELEMENTS = ${JSON.stringify(elements)};
  const DRIVES = ${JSON.stringify(drives)};
  const CONTEXTE = ${JSON.stringify(contexte)};
  const TAILLE = 120;
  const reponses = {
    rangementDemarrer: () => CONTEXTE,
    rangementBalayerPage: (jeton) => {
      const debut = Number(jeton || 0);
      return { elements: ELEMENTS.slice(debut, debut + TAILLE), jetonSuivant: debut + TAILLE < ELEMENTS.length ? String(debut + TAILLE) : null };
    },
    rangementDrivesPartages: () => ({ drives: DRIVES, complet: true, absorptions: { total: 0, causes: [] } }),
    rangementEnregistrerReglages: (r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, k === 'motsPersonnels' ? v : Number(v)])),
    rangementReinitialiserReglages: () => CONTEXTE.reglagesParDefaut,
    rangementPreparerPlan: () => {
      PLAN.plan = { id: 'plan-demo', url: 'https://docs.google.com/spreadsheets/d/plan-demo/edit', cree: '2026-09-27 20:10:00' };
      PLAN.restant = 31; PLAN.coche = true;   // l'aperçu fait comme si tout avait été coché dans Sheets
      return { ...PLAN.plan, lignes: 38, manuels: 2 };
    },
    rangementEtatPlan: () => etatPlan(),
    rangementLancerApplication: () => { PLAN.restant = 20; return { traitees: 11, restant: 20 }; },
    rangementPoursuivreApplication: () => { PLAN.restant = Math.max(0, PLAN.restant - 10); return { traitees: 10, restant: PLAN.restant }; },
    rangementArreterApplication: () => ({ arrete: true }),
    rangementPreparerAnnulation: () => {
      PLAN.annulation = { ...PLAN.plan };
      PLAN.plan = { id: 'annul-demo', url: 'https://docs.google.com/spreadsheets/d/annul-demo/edit', cree: '2026-09-27 20:30:00' };
      PLAN.restant = 25; PLAN.coche = true; PLAN.verifie = false;
      return { ...PLAN.plan, lignes: 25, ecartees: { rattachements: 2, constatesSansDeplacement: 0, destinationsIntrouvables: 0 }, aDefaire: 2 };
    },
    rangementVerifierDeplacements: () => { PLAN.verifie = true; return { verifies: 2, deplaces: 1 }; },
    rangementProposerIa: (resume) => ({
      principes: ['Aperçu local : proposition fictive, aucun appel n\\'est fait.'],
      noeuds: [
        { ref: 'n1', nom: 'Équipe Marketing', parent: '', role: 'drive_partage', justification: 'Travail d\\'équipe.', origines: resume.dossiers.filter((d) => /Marketing/.test(d.chemin)).map((d) => d.ref) },
        { ref: 'n2', nom: 'Finances', parent: '', role: 'mon_drive', justification: 'Pièces comptables.', origines: resume.dossiers.filter((d) => /Compta/.test(d.chemin)).map((d) => d.ref) },
        { ref: 'n3', nom: 'Archives', parent: '', role: 'archive', justification: 'Rien n\\'y bouge.', origines: resume.dossiers.filter((d) => d.dormant).map((d) => d.ref) },
      ],
      ecartes: { referencesInventees: 0, referencesEnDouble: 0, noeudsInvalides: 0 },
      nonPlaces: [], modeleDemande: 'gemini-3.8-flash', modele: 'gemini-3.8-flash', jetons: null,
    }),
  };
  // Plan simulé : trois passages pour aller au bout, un dossier à déplacer à la main.
  const PLAN = { plan: null, restant: 0, total: 0, coche: false, verifie: false, annulation: null };
  const etatPlan = () => (!PLAN.plan ? { plan: null } : {
    plan: PLAN.plan, lignes: 38, validees: PLAN.coche ? 38 : 0, aTraiter: PLAN.coche ? PLAN.restant : 0,
    parAction: PLAN.coche && PLAN.restant ? { 'Créer le Drive partagé': 1, 'Ajouter au Drive partagé': 3, Ranger: 22, Archiver: 1, Regrouper: 2, Rattacher: 2 } : {},
    parEtat: PLAN.coche && PLAN.restant < 31 ? { Fait: 31 - PLAN.restant, 'À faire': 7 + PLAN.restant } : { 'À faire': 38 },
    notifications: PLAN.coche && PLAN.restant ? 3 : 0,
    nombreEchecs: PLAN.restant === 0 && PLAN.coche && !PLAN.annulation ? 1 : 0,
    annulables: PLAN.restant === 0 && PLAN.coche ? 27 : 0,
    annulation: PLAN.annulation,
    aDefaire: PLAN.annulation ? [
      { quoi: 'Drive partagé créé', element: 'Client Acme', lien: 'https://drive.google.com/drive/folders/demo', comment: 'Le supprimer se fait dans Drive, une fois vidé ; membres ajoutés par l\\'outil : paul.roux@exemple.fr.' },
      { quoi: 'Élément rattaché', element: 'Vieux devis.pdf', lien: '', comment: 'Il n\\'avait aucun dossier : l\\'y remettre n\\'aurait pas de sens.' },
    ] : [],
    echecs: PLAN.restant === 0 && PLAN.coche && !PLAN.annulation ? [{ ligne: 12, action: 'Ranger', element: 'Note réunion', detail: 'L\\'élément a été déplacé depuis la préparation du plan. Laissé où il est.' }] : [],
    manuels: [{ ligne: 2, dossier: 'Marketing 2026', drive: 'Équipe Marketing', remarque: '', etat: PLAN.verifie ? 'Fait (constaté)' : 'À faire', verifie: PLAN.verifie ? '2026-09-27 20:15:00' : '', idDossier: 'demo1', idDrive: 'dp-marketing' },
      { ligne: 3, dossier: 'Client Acme', drive: 'Client Acme', remarque: '35 éléments appartiennent à des personnes extérieures : Google refusera le déplacement.', etat: 'À faire', verifie: '', idDossier: 'demo2', idDrive: '' }],
    enCours: null,
  });
  const executeur = (succes, echec) => new Proxy({}, {
    get: (_, nom) => {
      if (nom === 'withSuccessHandler') return (f) => executeur(f, echec);
      if (nom === 'withFailureHandler') return (f) => executeur(succes, f);
      return (...args) => setTimeout(() => {
        try { succes({ ok: true, valeur: reponses[nom](...args) }); } catch (e) { echec(e); }
      }, 150);
    },
  });
  window.google = { script: { run: executeur(() => {}, () => {}) } };
})();
</script>`;

/* ------------------------------------------------------------ assemblage */

const lire = (nom) => fs.readFileSync(path.join(SOURCES, `${nom}.html`), 'utf8');
const page = lire('Index')
  .replace(/<\?!= SocleWeb\.inclure\('([^']+)'\) \?>/g, (_, nom) => lire(nom))
  // Ce que SocleWeb.page ajoute côté serveur par addMetaTag.
  .replace('<meta charset="utf-8">', '<meta charset="utf-8">\n  <meta name="viewport" content="width=device-width, initial-scale=1">')
  .replace('</head>', `${fauxServeur}\n</head>`);

// Chaque script de la page doit au moins se compiler : une apostrophe mal
// échappée dans le faux serveur a déjà produit une page morte sans que rien
// ne le signale ici.
[...page.matchAll(/<script>([\s\S]*?)<\/script>/g)].forEach((m, rang) => {
  try {
    new Function(m[1]); // eslint-disable-line no-new-func
  } catch (erreur) {
    throw new Error(`Le script n° ${rang + 1} de l'aperçu ne se compile pas : ${erreur.message}`);
  }
});

const sortie = path.join(__dirname, 'apercu.html');
fs.writeFileSync(sortie, page);
console.log(`${sortie} — ${elements.length} éléments fictifs.`);
