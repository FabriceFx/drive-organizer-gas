# Journal des modifications

Format inspiré de [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/).
Ce projet suit le [Semantic Versioning](https://semver.org/lang/fr/).

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
