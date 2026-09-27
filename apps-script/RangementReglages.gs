/**
 * Rangement Drive — réglages de chacun. Introduit en v0.1.
 *
 * Les seuils relèvent du jugement : ce qui est « trop profond » pour l'un est
 * l'organisation normale d'un autre. Ils ne vivent donc pas dans le code mais
 * dans les propriétés **de la personne** : chacun règle les siens depuis
 * l'interface, sans déploiement, et sans toucher à ceux des autres.
 *
 * Le code ne fournit que les valeurs par défaut, et les bornes qui empêchent
 * un réglage absurde de produire un rapport absurde.
 */

const RANGEMENT_PROPRIETE_REGLAGES_ = 'RANGEMENT_REGLAGES';

const RANGEMENT_REGLAGES_DEFAUT_ = {
  racineMax: 15,
  profondeurMax: 6,
  fourreToutMin: 150,
  dormantAnnees: 3,
  seuilDrivePartage: 50,
  seuilAExaminer: 35,
  motsPersonnels: 'perso, personnel, privé, famille, impôts, santé, médical, cv, '
    + 'photos, banque, maison, vacances, enfants, mutuelle, fiche de paie, bulletins de salaire',
};

/** Bornes de chaque réglage numérique : [minimum, maximum]. */
const RANGEMENT_REGLAGES_BORNES_ = {
  racineMax: [0, 1000],
  profondeurMax: [2, 30],
  fourreToutMin: [20, 10000],
  dormantAnnees: [1, 20],
  seuilDrivePartage: [10, 100],
  seuilAExaminer: [5, 100],
};

/**
 * Valide un jeu de réglages et rend sa forme propre. Lève en nommant le champ
 * fautif et la plage permise : « valeur invalide » seul ne se corrige pas.
 */
const rangementValiderReglages_ = (saisie) => {
  const source = saisie && typeof saisie === 'object' ? saisie : {};
  const propres = {};

  Object.keys(RANGEMENT_REGLAGES_BORNES_).forEach((cle) => {
    const [minimum, maximum] = RANGEMENT_REGLAGES_BORNES_[cle];
    const brut = source[cle] ?? RANGEMENT_REGLAGES_DEFAUT_[cle];
    const nombre = Number(brut);
    if (!Number.isInteger(nombre) || nombre < minimum || nombre > maximum) {
      throw SocleErreurs.erreur({
        quoi: `Le réglage « ${cle} » vaut « ${brut} ».`,
        quoiFaire: `Saisissez un nombre entier entre ${minimum} et ${maximum}.`,
      });
    }
    propres[cle] = nombre;
  });

  if (propres.seuilAExaminer > propres.seuilDrivePartage) {
    throw SocleErreurs.erreur({
      quoi: 'Le seuil « à examiner » dépasse celui du Drive partagé recommandé.',
      quoiFaire: 'Choisissez un seuil « à examiner » inférieur ou égal à l\'autre : '
        + 'c\'est l\'antichambre de la recommandation.',
    });
  }

  const mots = String(source.motsPersonnels ?? RANGEMENT_REGLAGES_DEFAUT_.motsPersonnels);
  if (mots.length > 2000) {
    throw SocleErreurs.erreur({
      quoi: 'La liste des mots personnels dépasse 2 000 caractères.',
      quoiFaire: 'Raccourcissez-la : quelques dizaines de mots suffisent à reconnaître '
        + 'un dossier personnel.',
    });
  }
  propres.motsPersonnels = mots;
  return propres;
};

/**
 * Les réglages de la personne, complétés par les défauts. Un réglage illisible
 * — propriété corrompue, ancien format — retombe sur les défauts, mais la
 * retombée est comptée : l'interface peut alors dire que ses réglages n'ont
 * pas été appliqués, au lieu de les ignorer en silence.
 */
const rangementLireReglages_ = () => SocleErreurs.absorber('réglages personnels illisibles', () => {
  const brut = PropertiesService.getUserProperties().getProperty(RANGEMENT_PROPRIETE_REGLAGES_);
  if (!brut) return { ...RANGEMENT_REGLAGES_DEFAUT_ };
  return rangementValiderReglages_({ ...RANGEMENT_REGLAGES_DEFAUT_, ...JSON.parse(brut) });
}, { ...RANGEMENT_REGLAGES_DEFAUT_ });

const rangementEcrireReglages_ = (saisie) => {
  const propres = rangementValiderReglages_(saisie);
  PropertiesService.getUserProperties()
    .setProperty(RANGEMENT_PROPRIETE_REGLAGES_, JSON.stringify(propres));
  return propres;
};

const rangementEffacerReglages_ = () => {
  PropertiesService.getUserProperties().deleteProperty(RANGEMENT_PROPRIETE_REGLAGES_);
  return { ...RANGEMENT_REGLAGES_DEFAUT_ };
};
