<a id="francais"></a>

# Rangement Drive (`drive-organizer-gas`)

📖 Français (ci-dessous) · [🇬🇧 English version](#english) · [GitHub](https://github.com/FabriceFx/drive-organizer-gas)

Chacun ouvre une URL et voit **l'état de son Google Drive** : les dossiers d'équipe
hébergés dans Mon Drive qui devraient être dans un Drive partagé, le désordre
(racine encombrée, fourre-tout, copies, versions faites à la main, fichiers rangés
nulle part), et une **hiérarchie proposée** où chaque déplacement dit pourquoi.

Puis, si la personne le veut, l'outil **range** : il écrit un plan dans un classeur
Google Sheets, elle le relit et coche ce qu'elle approuve, et seules les lignes cochées
sont appliquées. **Jamais de suppression**, et le contenu des fichiers n'est jamais lu.

Pour l'installer, voir **[DEMARRAGE.md](DEMARRAGE.md)**.

## Ce qu'il montre

| Onglet | Contenu |
|---|---|
| Synthèse | Indice de rangement sur 100, **avec le détail de chaque pénalité**, et par où commencer. |
| Drives partagés | Dossiers d'équipe regroupés par cercle de collègues, score détaillé, membres et rôles proposés, Drive partagé existant qui conviendrait, obstacles que Google opposera au déplacement. |
| Constats | Treize sortes de désordre, chacune avec son calcul, son conseil et la liste des éléments. |
| Hiérarchie proposée | L'arborescence cible et la liste des mouvements, marqués « fait » ou « présomption ». Export CSV. Préparation du plan. |
| Application | Le décompte exact de ce qui sera fait, la confirmation, la progression ; les dossiers à faire glisser soi-même vers un Drive partagé, et leur vérification. |
| Proposition IA | En option : une arborescence nommée par Gemini, à partir des seuls chemins de dossiers. |
| Réglages, Aide | Les seuils de chacun ; le fonctionnement expliqué à l'endroit où l'on s'en sert. |

## Le score « Drive partagé »

Un dossier de Mon Drive dont d'autres sont les principaux auteurs est un dossier
d'équipe hébergé chez une personne : son départ le fait perdre à l'équipe.

| Signal | Points |
|---|---|
| Collègues en écriture sur le dossier (un groupe compte pour 3) | 10 chacun, 30 au plus |
| Part des fichiers modifiés en dernier par quelqu'un d'autre | jusqu'à 30 |
| Part des fichiers appartenant à quelqu'un d'autre | jusqu'à 20 |
| Modifié dans les 90 jours / dans l'année | 20 / 10 |
| Nom évoquant la vie privée (« Perso », « Impôts »… réglable) | score ramené à 0 |

Recommandé à partir de 50, « à examiner » à partir de 35 (réglables). Seul le
dossier le plus haut d'une branche est proposé : ses sous-dossiers partent avec lui.

**Obstacles signalés**, d'après l'[aide de Google](https://knowledge.workspace.google.com/admin/drive/move-your-organizations-content-to-shared-drives) :
refus si 25 éléments ou 10 % du contenu appartiennent à des personnes extérieures, au-delà
de 100 000 éléments, ou de 20 niveaux de dossiers.

## Plan puis application

| Temps | Ce qui se passe |
|---|---|
| Préparer | Un classeur « Plan de rangement Drive » est créé dans le Drive de la personne (dossier *Rangement Drive — plans*) : une ligne par action, **rien n'est coché**, rien n'est fait. |
| Valider | La personne relit dans Sheets, coche « Valider » sur ce qu'elle approuve, corrige au besoin la colonne Destination (un chemin sous Mon Drive). |
| Appliquer | L'application annonce le nombre exact de lignes cochées, demande confirmation, refuse si le plan a changé depuis, puis traite la file en marquant chaque ligne au moment où elle est traitée. |

| Ce que l'outil fait | Ce qu'il laisse à la main |
|---|---|
| Ranger, archiver, regrouper, rattacher dans Mon Drive, en créant les dossiers manquants | Déplacer un **dossier** vers un Drive partagé : l'API le refuse (`teamDrivesFolderMoveInNotSupported`). L'interface Drive le fait en gardant les liens ; l'outil fournit les liens, puis **constate** le déplacement. |
| Créer un Drive partagé ; y ajouter les membres proposés (gestionnaire de contenu, contributeur, commentateur, lecteur) | Aplatir un niveau, fusionner des homonymes : présomptions sur la structure, signalées seulement. |

| Choix | Pourquoi |
|---|---|
| Le plan vit dans un classeur Sheets | Il est à la fois la file, le curseur et le journal, là où un humain le relit. Motif `PlanPuisApplication`, recopié avec le classeur et le verrou injectables. |
| Rien n'est coché d'office | Une ligne non cochée ne sera jamais traitée. |
| Avant chaque action, l'état réel est relu | Un élément déplacé depuis la préparation est laissé où il est ; un élément déjà à destination est constaté, pas déplacé deux fois. |
| Destination corrigée à la main = chemin résolu nom par nom | Le référentiel humain l'emporte sur le calcul de l'outil. |
| Dossier cherché par son nom avant d'être créé | Une exécution tuée après une création ne produit pas de doublon à la reprise. |
| Drive partagé créé avec un jeton d'idempotence, conservé dans le plan | Google ne crée jamais deux Drives pour un même jeton ; interrompu, il est retrouvé, pas recréé. |
| Rôle « gestionnaire » jamais attribué par l'outil | Donner le droit de supprimer le Drive reste un geste fait dans Drive. |
| Verrou de la personne | Deux onglets, ou un onglet et le déclencheur de reprise, ne traitent jamais la même file. |
| Déclencheur de reprise, à son nom | Fenêtre fermée, l'application continue par tranches de 4 minutes ; « Arrêter » retire l'autorisation et le déclencheur. Ce temps compte dans le [quota Google](https://developers.google.com/apps-script/guides/services/quotas) de durée cumulée des déclencheurs (6 h par jour et par personne en Workspace, 90 min pour un compte gmail.com) ; fenêtre ouverte, il ne compte pas. |
| État écrit ligne par ligne, et vidé aussitôt | Aucun quota de Google ne porte sur les écritures `SpreadsheetApp` ; le coût est du temps, et c'est le prix d'une reprise qui sait exactement où elle en est. |
| Noms écrits en texte dans le plan | Un fichier nommé `=IMPORTXML(…)` ne devient pas une formule dans le classeur. |

Le banc tue l'exécution à **chaque** vidage d'écriture possible, puis la reprend : aucun
élément n'est jamais déplacé deux fois, aucun Drive créé deux fois, aucun membre ajouté
deux fois, et toutes les lignes finissent « Fait ».

## Annuler un plan

Un plan appliqué s'annule par un **plan inverse** : un nouveau classeur, qui devient le plan
courant, à relire, cocher et appliquer comme tout plan. Le plan d'origine reste intact.

| Ce qui est remis en place | Ce qui ne l'est pas, et pourquoi |
|---|---|
| Chaque élément rangé, archivé ou regroupé par l'outil revient dans son dossier d'origine, que le plan avait gardé. | Un **Drive partagé créé** et ses **membres** : les défaire, c'est supprimer, ce que l'outil ne fait jamais. Listés dans l'onglet *À défaire dans Drive*, avec leurs liens. |
| Un élément trouvé « déjà à destination » après une tentative interrompue : très probablement déplacé par l'outil, remis en place avec la mention « présomption ». | Un élément trouvé déjà à destination au premier essai : quelqu'un l'y avait mis, l'outil ne défait pas ce qu'il n'a pas fait. |
| | Un élément **rattaché** : il n'avait aucun dossier, l'y remettre n'aurait pas de sens. |
| | Un dossier déplacé à la main vers un Drive partagé : sa propriété est passée à l'organisation, le retour se fait dans Drive. |

| Choix | Pourquoi |
|---|---|
| L'annulation est un plan | Mêmes garde-fous que le rangement : relecture, cases à cocher, décompte confirmé, état relu avant chaque action, reprise sans doublon. |
| Emplacement actuel retrouvé **sans rien créer** | Préparer une annulation ne touche pas à Drive ; un dossier de rangement renommé depuis rend la ligne introuvable, écartée et comptée. |
| Les dossiers créés par le rangement restent | Vides après l'annulation, ils seront signalés à la prochaine analyse ; les supprimer serait une suppression. |

## Choix de conception

| Choix | Pourquoi |
|---|---|
| Application web « exécuter en tant que l'utilisateur qui accède » | Chacun ne voit que son Drive, sous son identité ; une seule URL à diffuser. |
| Analyse et application séparées | L'analyse ne modifie rien ; seule l'application écrit, et seulement ce qui est coché. |
| Balayage piloté par le navigateur, une page par appel | Chaque appel dure une seconde, loin du plafond des 6 minutes ; la progression est réelle. |
| Analyse dans le navigateur | Les données y sont déjà ; changer un seuil réanalyse sans relire Drive. |
| Réglages dans les propriétés **de la personne** | Chacun règle les siens, sans déploiement, sans toucher ceux des autres. |
| « fait » et « présomption » séparés partout | Un doublon deviné sur le nom et la taille n'a pas la valeur d'un fichier sans dossier. |
| Partages non rendus par Google = « non mesuré » | Ne jamais lire « aucun partage » là où l'on n'a rien su. |
| Orphelin = à soi **et** sans aucun parent | Un fichier déposé dans le dossier d'un collègue est rangé, ailleurs ; c'est la définition de `is:unorganized`. |
| « Client A / Devis » et « Client B / Devis » non signalés | Une structure régulière n'est pas un doublon. |
| Ce qui est déjà dans des archives n'est pas proposé aux archives | Évident une fois écrit, faux avant. |
| Interface construite sans `innerHTML` | Un nom de fichier piégé s'affiche, il ne s'exécute pas ; le banc le vérifie. |
| Export CSV qui neutralise `=`, `+`, `-`, `@` | Un fichier nommé `=HYPERLINK(…)` ne devient pas une formule chez qui ouvre l'export. |

## L'option IA

Désactivée tant que l'administrateur n'a pas posé de clé d'API Gemini — **d'un projet facturé** : sur le niveau gratuit, Google réutilise les requêtes ([conditions](https://ai.google.dev/gemini-api/terms)).

| Garde-fou | Comment |
|---|---|
| Ce qui part | Chemins de dossiers et compteurs. Ni nom de fichier, ni adresse, ni identifiant Drive. |
| Consentement | L'envoi exact est affiché ; une case à cocher, à chaque envoi. |
| Ce qui revient | Revalidé : référence inventée, doublon, boucle ou rôle inconnu sont écartés **et comptés**. |
| Coût | 5 demandes par personne et par jour, décomptées avant l'appel. |
| Modèle | `gemini-3.8-flash` (le Flash stable ; le Pro n'existe qu'en préversion), réflexion moyenne, sortie JSON par `responseFormat`. |
| API | `generateContent`, sans état, plutôt que l'API Interactions qui conserve chaque échange par défaut. La clé part dans l'en-tête `x-goog-api-key`, jamais dans l'URL. |
| Injection | Les chemins sont déclarés au modèle comme des données, et le serveur revalide la forme de l'envoi : un appel forgé ne peut pas se servir de la clé pour autre chose. |

## Portées demandées

Depuis la v0.2, le rangement exige la portée `drive` complète : Google ne propose pas de
portée qui permette de déplacer sans permettre aussi de supprimer. Plutôt que de le
taire, voici ce que chaque portée permettrait, et la compensation **vérifiable** :

| Portée | Pour quoi | Ce qu'elle permettrait d'autre, et ce qui le garantit |
|---|---|---|
| `drive` | Lire les métadonnées ; déplacer ; créer des dossiers et des Drives partagés ; ajouter des membres. | Supprimer, vider la corbeille, retirer des droits, lire le contenu. **Aucun appel du projet ne le fait** : ni `delete`, ni `emptyTrash`, ni `trashed: true`, ni `Permissions.delete/update`, ni export ou téléchargement. Les écritures sont confinées à `RangementPlan.gs` ; `Files.update` n'y reçoit qu'une ressource vide (ni renommage ni corbeille) ; `Files.create` n'y crée que des dossiers ; aucun partage par lien ou au domaine. |
| `spreadsheets` | Écrire et relire le classeur du plan. | Modifier tout classeur de la personne — le projet n'ouvre que celui qu'il a créé, dont l'identifiant est gardé dans ses propriétés. |
| `script.scriptapp` | Le déclencheur de reprise, quand la fenêtre est fermée. | Rien hors de ce projet. |
| `script.external_request` | L'option IA. | Appeler n'importe quelle URL — **un seul** appel HTTP existe, dans `RangementIa.gs`, vers `generativelanguage.googleapis.com`. |

`drive` est une portée restreinte : sans objet pour une application interne au domaine,
mais un audit de sécurité Google serait exigé pour la publier hors de l'organisation.
Toutes ces compensations se vérifient d'un `grep`, et `node banc/test.js` les vérifie à chaque passage.

## Fichiers

| Fichier | Rôle |
|---|---|
| `Rangement.gs` | Points d'entrée : tout ce que le navigateur peut appeler, et rien d'autre. |
| `RangementDrive.gs` | Lecture de Drive, traduction en enregistrements compacts. |
| `RangementReglages.gs` | Valeurs par défaut, bornes, lecture et écriture des réglages. |
| `RangementIa.gs` | Appel à Gemini, validation de l'envoi et de la réponse, quota. |
| `RangementPlan.gs` | Le plan : préparation, application ligne à ligne, vérification des déplacements manuels, annulation. Seul fichier qui écrit dans Drive. |
| `PlanPuisApplication.gs` | Le motif, recopié de `plan-puis-application` 0.1.1 avec deux points d'injection (classeur, verrou). |
| `RangementAnalyse.html` | L'analyse, en fonctions pures — le banc l'exécute dans Node. |
| `RangementClient.html`, `Index.html` | L'interface. |
| `Socle*.gs`, `Socle*.html` | Recopiés de `socle-apps-script` 0.12.2 : dates, reprises, erreurs, secrets, web, style. |

## Banc d'essai

```bash
node banc/test.js
```

Sans Google : le serveur face à des faux services qui refusent ce
que les vrais refusent (un champ absent de `fields` n'est pas rendu), l'analyse sur un
Drive fictif qui porte chaque désordre, et les invariants de la source. Chaque défaut
corrigé a son cas ; réintroduit, il fait échouer le banc.

```bash
node banc/apercu.js
```

Produit `banc/apercu.html` : l'interface complète sur un Drive fictif, à ouvrir dans un navigateur par un serveur local.

## Limites connues

- Mon Drive seulement : le contenu des Drives partagés n'est pas analysé.
- Les doublons se devinent au nom et à la taille, sans lire le contenu : présomption.
- Le rapprochement « fichier de la racine → dossier » ne regarde que les mots des noms.
- Déplacer un dossier vers un Drive partagé reste manuel : l'API ne le permet pas.
- L'annulation ne supprime rien : Drives partagés créés, membres ajoutés et dossiers créés se défont à la main.
- L'interface est en français.

Développé par [Fabrice Faucheux](https://faucheux.bzh) — Dépôt : [github.com/FabriceFx/drive-organizer-gas](https://github.com/FabriceFx/drive-organizer-gas)  
Licence **Elastic 2.0** — voir [LICENSE](LICENSE).

---

<a id="english"></a>

# Drive tidy-up (`drive-organizer-gas`)

Each user opens one URL and sees **the state of their Google Drive**: team folders
living in My Drive that belong in a shared drive, the clutter (crowded root, dumping
grounds, copies, hand-made versions, unorganized files), and a **proposed hierarchy**
where every move says why. Then, if asked, it **tidies up**: it writes a plan into a Google
Sheets file, the user ticks what they approve, and only ticked lines are applied. Nothing is
ever deleted; file contents are never read.

- Web app running as the accessing user. Scopes: `drive` (moving requires it; no delete, trash or permission removal anywhere in the code, checked by the test bench), `spreadsheets` (the plan), `script.scriptapp` (background resume), `script.external_request` (optional AI only).
- Plan then apply: exact count confirmed before applying; each line re-reads the real state first; resumable after being killed at any point without doing anything twice. Moving a folder into a shared drive stays manual (the API refuses it); the tool links to it and verifies it.
- Undo: an applied plan is reversed by an inverse plan, reviewed and ticked like any plan; created shared drives and their members are listed, never deleted.
- Browser-driven scan (one page per call, far from the 6-minute cap); analysis runs in the browser.
- Every score shows its breakdown; facts and presumptions are kept apart; "not measured" is never counted as zero.
- Optional AI (Gemini 3.8 Flash, paid-tier key required): only folder paths and counters are sent, after explicit consent; the response is validated; 5 requests per user per day.
- Test bench: `node banc/test.js`. Setup: [DEMARRAGE.md](DEMARRAGE.md) (French).

Developed by [Fabrice Faucheux](https://faucheux.bzh) — Repository: [github.com/FabriceFx/drive-organizer-gas](https://github.com/FabriceFx/drive-organizer-gas)  
Licensed under **Elastic License 2.0** — see [LICENSE](LICENSE).
