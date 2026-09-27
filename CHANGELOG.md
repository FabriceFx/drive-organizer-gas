# Journal des modifications

Format inspiré de [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/).
Ce projet suit le [Semantic Versioning](https://semver.org/lang/fr/).

## [0.2.0] - 2026-09-27

Le rangement : plan puis application.

### Ajouté

- **Préparer le plan** (onglet Hiérarchie proposée) : un classeur « Plan de rangement Drive » est écrit dans le Drive de la personne, une ligne par action, rien de coché. Onglets *Plan*, *À déplacer dans Drive* et *Mode d'emploi*.
- **Onglet Application** : décompte exact des lignes cochées par action, avertissement sur les notifications envoyées aux nouveaux membres, confirmation revérifiée au lancement (refus si le plan a changé depuis la relecture), progression, arrêt, liste des échecs.
- Actions appliquées : ranger, archiver, regrouper, rattacher dans Mon Drive (dossiers manquants créés) ; création des Drives partagés proposés ; ajout de leurs membres.
- Déplacements vers un Drive partagé listés à part, avec liens, et **vérifiés** dans Drive : l'API refuse de déplacer un dossier de Mon Drive vers un Drive partagé.
- Reprise en arrière-plan par déclencheur quand la fenêtre est fermée.
- `PlanPuisApplication.gs` recopié de `plan-puis-application` 0.1.1, avec le classeur et le verrou injectables.

### Modifié

- Portées : `drive` remplace `drive.readonly` ; ajout de `spreadsheets` et `script.scriptapp`. Chaque utilisateur doit autoriser de nouveau. Compensations vérifiées par le banc : ni suppression, ni corbeille, ni renommage, ni retrait de droits ; écritures confinées à `RangementPlan.gs`.
- Les mouvements de la hiérarchie portent désormais leur cible exacte (dossier existant, chemin à créer, Drive partagé) et l'emplacement d'origine de l'élément.
- Un dossier déjà nommé « Personnel » sert de destination au regroupement au lieu d'y être déplacé lui-même.
- Un dossier de destination existant n'est vérifié qu'une fois par exécution, et non une fois par élément rangé.

### Sécurité

- Avant chaque action, l'état réel est relu : un élément déplacé depuis la préparation est laissé en place, un élément déjà à destination est constaté.
- Noms de fichiers écrits en texte dans le plan : un nom commençant par `=` ne devient pas une formule.
- Banc : l'exécution est tuée à chaque vidage d'écriture possible puis reprise ; aucun déplacement, aucune création de Drive, aucun ajout de membre n'a lieu deux fois.
- Création de Drive partagé refusée (politique de l'organisation) : la ligne échoue en disant quoi faire et la file continue. Un Drive retrouvé par son nom n'est adopté que s'il résulte d'une tentative précédente de la même ligne **et** qu'il a été créé après la préparation du plan — sans quoi l'outil aurait pris le Drive d'un collègue pour le sien et y aurait ajouté des membres.

## [0.1.0] - 2026-09-27

Première version : diagnostic en lecture seule.

### Ajouté

- Application web par utilisateur (« exécuter en tant que l'utilisateur qui accède »), portée `drive.readonly`.
- Balayage de Mon Drive piloté par le navigateur, page par page, avec reprise après interruption ; une lecture partielle s'analyse et se signale comme telle.
- Candidats au Drive partagé : score sur 100 en quatre signaux détaillés, regroupement par cercle de collègues, membres et rôles proposés, rapprochement des Drives partagés existants, obstacles documentés par Google (éléments d'externes, 100 000 éléments, 20 niveaux).
- Treize constats : racine encombrée, éléments sans dossier, profondeur, fourre-tout, dossier vide, niveau inutile, dossiers homonymes, copies, sans-titre, doublons probables, versions manuelles, dates mélangées, branches dormantes.
- Hiérarchie proposée : arborescence cible et mouvements motivés, marqués « fait » ou « présomption » ; export CSV.
- Indice de rangement sur 100 avec le détail de chaque pénalité.
- Proposition d'arborescence par Gemini (`gemini-3.8-flash`, API `generateContent`), en option : clé d'un projet facturé exigée, envoi limité aux chemins de dossiers, affiché et consenti ; réponse revalidée ; quota quotidien par personne.
- Réglages par personne, sans déploiement ; onglet d'aide.
- Banc d'essai hors Google (`node banc/test.js`) et aperçu de l'interface (`node banc/apercu.js`).
