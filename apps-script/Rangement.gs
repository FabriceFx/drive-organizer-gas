/**
 * Rangement Drive — points d'entrée de l'application web. Introduit en v0.1.
 *
 * Déployée en « Exécuter en tant que : l'utilisateur qui accède ». Chacun ouvre
 * la même URL et n'analyse que son propre Drive, sous sa propre identité :
 * personne, pas même l'administrateur qui a déployé, ne voit le Drive d'un
 * autre.
 *
 * Le serveur ne fait que lire Drive, page par page. **L'analyse tourne dans le
 * navigateur** (RangementAnalyse.html), pour trois raisons :
 *
 *   - les éléments y sont déjà, puisque c'est le navigateur qui pilote le
 *     balayage ; les renvoyer au serveur ferait transiter plusieurs mégaoctets
 *     à chaque changement de réglage ;
 *   - le plafond des six minutes ne s'y applique pas : un Drive de cent mille
 *     éléments s'analyse en quelques secondes côté client ;
 *   - changer un seuil relance l'analyse sans relire Drive.
 *
 * Tout ce qui est appelable par le navigateur est ici, et nulle part ailleurs :
 * la liste de ce qui est exposé se lit d'un coup d'œil. Ces fonctions ne
 * portent pas de trait de soulignement final — Apps Script refuse de les
 * servir à `google.script.run` sinon, et l'appel échoue côté client, hors de
 * portée de tout gestionnaire d'erreur (payé dans ménage-gmail 1.1.1).
 */

/** Seule source du numéro de version ; le banc vérifie qu'il vaut VERSION. */
const RANGEMENT_VERSION_ = '0.1.0';

function doGet() {
  return SocleWeb.page({
    fichier: 'Index',
    titre: 'Rangement de mon Drive',
    gabarit: true,
  });
}

/** Qui est là, où est sa racine, quels réglages s'appliquent. */
function rangementDemarrer() {
  return SocleWeb.frontiere('rangementDemarrer', () => {
    SocleErreurs.oublier();
    return rangementContexte_();
  });
}

/**
 * Une page du balayage. Le navigateur rappelle avec le jeton rendu tant qu'il
 * n'est pas nul : chaque appel dure une ou deux secondes, bien loin des six
 * minutes, et la progression affichée est réelle.
 */
function rangementBalayerPage(jeton) {
  return SocleWeb.frontiere('rangementBalayerPage', () => rangementPage_(jeton));
}

/** Les Drives partagés existants et leurs membres, pour les rapprocher des candidats. */
function rangementDrivesPartages() {
  return SocleWeb.frontiere('rangementDrivesPartages', () => {
    SocleErreurs.oublier();
    return rangementListerDrivesPartages_();
  });
}

function rangementEnregistrerReglages(reglages) {
  return SocleWeb.frontiere('rangementEnregistrerReglages',
    () => rangementEcrireReglages_(reglages));
}

function rangementReinitialiserReglages() {
  return SocleWeb.frontiere('rangementReinitialiserReglages',
    () => rangementEffacerReglages_());
}

/**
 * Proposition d'arborescence par Gemini. Le navigateur n'envoie que ce que
 * l'utilisateur a vu et accepté d'envoyer ; le serveur le revalide de toute
 * façon, parce qu'un appel forgé pourrait se servir de la clé de
 * l'organisation pour tout autre chose.
 */
function rangementProposerIa(resume) {
  return SocleWeb.frontiere('rangementProposerIa', () => rangementDemanderIa_(resume));
}

/**
 * À exécuter depuis l'éditeur par l'administrateur, une fois :
 *
 *     rangementDefinirDomainesInternes('exemple.fr, exemple.com')
 *
 * Le domaine de chaque utilisateur est toujours compté comme interne ; ce
 * réglage ajoute les domaines secondaires et alias. Sans lui, un collègue dont
 * l'adresse est sur un domaine secondaire passerait pour un externe, et ses
 * fichiers pour des fichiers qu'on ne peut pas déplacer dans un Drive partagé.
 */
function rangementDefinirDomainesInternes(liste) {
  const domaines = rangementNormaliserDomaines_(liste);
  PropertiesService.getScriptProperties()
    .setProperty(RANGEMENT_PROPRIETE_DOMAINES_, domaines.join(','));
  console.log(`Domaines internes enregistrés : ${domaines.join(', ') || '(aucun)'}`);
  return domaines;
}

/**
 * Pose ou retire la clé de l'option IA.
 *
 * Pour la poser, préférer l'écran « Paramètres du projet > Propriétés du
 * script » (propriété RANGEMENT_CLE_GEMINI) : une clé tapée dans l'éditeur,
 * même le temps d'une exécution, finit dans l'historique des versions si le
 * fichier est enregistré. Cette fonction sert surtout à désactiver :
 *
 *     rangementDefinirCleIa('')
 */
function rangementDefinirCleIa(cle) {
  rangementDeclarerSecretIa_();
  const valeur = String(cle ?? '').trim();
  if (valeur === '') {
    SocleSecrets.oublier(RANGEMENT_SECRET_IA_);
    console.log('Clé retirée : l\'option IA est désactivée pour tous.');
    return 'désactivée';
  }
  SocleSecrets.ecrire(RANGEMENT_SECRET_IA_, valeur);
  console.log(`Clé enregistrée (${SocleSecrets.masquer(valeur)}) : l'option IA est proposée.`);
  return 'activée';
}
