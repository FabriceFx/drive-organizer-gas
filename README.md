<a id="francais"></a>

# Rangement Drive (`drive-organizer-gas`)

📖 Français (ci-dessous) · [🇬🇧 English version](#english) · [GitHub](https://github.com/FabriceFx/drive-organizer-gas)

Chacun ouvre une URL et voit **l'état de son Google Drive** : les dossiers d'équipe
hébergés dans Mon Drive qui devraient être dans un Drive partagé, le désordre
(racine encombrée, fourre-tout, copies, versions faites à la main, fichiers rangés
nulle part), et une **hiérarchie proposée** où chaque déplacement dit pourquoi.

L'outil **ne modifie rien** : lecture seule, et le contenu des fichiers n'est jamais lu.

Pour l'installer, voir **[DEMARRAGE.md](DEMARRAGE.md)**.

## Ce qu'il montre

| Onglet | Contenu |
|---|---|
| Synthèse | Indice de rangement sur 100, **avec le détail de chaque pénalité**, et par où commencer. |
| Drives partagés | Dossiers d'équipe regroupés par cercle de collègues, score détaillé, membres et rôles proposés, Drive partagé existant qui conviendrait, obstacles que Google opposera au déplacement. |
| Constats | Treize sortes de désordre, chacune avec son calcul, son conseil et la liste des éléments. |
| Hiérarchie proposée | L'arborescence cible et la liste des mouvements, marqués « fait » ou « présomption ». Export CSV. |
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

## Choix de conception

| Choix | Pourquoi |
|---|---|
| Application web « exécuter en tant que l'utilisateur qui accède » | Chacun ne voit que son Drive, sous son identité ; une seule URL à diffuser. |
| Portée `drive.readonly` | L'outil ne peut rien casser ; les rangements restent une décision humaine. |
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

| Portée | Pour quoi | Ce qu'elle permettrait d'autre |
|---|---|---|
| `drive.readonly` | Lire les métadonnées de Mon Drive et la liste des Drives partagés. | Lire le contenu des fichiers — **aucun appel du projet ne le fait** (aucune méthode de téléchargement ni d'export). |
| `script.external_request` | L'option IA. | Appeler n'importe quelle URL — le banc vérifie qu'**un seul** appel HTTP existe, dans `RangementIa.gs`, vers `generativelanguage.googleapis.com`. |

Ces deux compensations se vérifient d'un `grep`, et `node banc/test.js` les vérifie à chaque passage.

## Fichiers

| Fichier | Rôle |
|---|---|
| `Rangement.gs` | Points d'entrée : tout ce que le navigateur peut appeler, et rien d'autre. |
| `RangementDrive.gs` | Lecture de Drive, traduction en enregistrements compacts. |
| `RangementReglages.gs` | Valeurs par défaut, bornes, lecture et écriture des réglages. |
| `RangementIa.gs` | Appel à Gemini, validation de l'envoi et de la réponse, quota. |
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
- L'interface est en français.

Développé par [Fabrice Faucheux](https://faucheux.bzh) — Dépôt : [github.com/FabriceFx/drive-organizer-gas](https://github.com/FabriceFx/drive-organizer-gas)  
Licence **Elastic 2.0** — voir [LICENSE](LICENSE).

---

<a id="english"></a>

# Drive tidy-up (`drive-organizer-gas`)

Each user opens one URL and sees **the state of their Google Drive**: team folders
living in My Drive that belong in a shared drive, the clutter (crowded root, dumping
grounds, copies, hand-made versions, unorganized files), and a **proposed hierarchy**
where every move says why. **Read-only**: nothing is changed, file contents are never read.

- Web app running as the accessing user; scope `drive.readonly`, plus `script.external_request` for the optional AI proposal only.
- Browser-driven scan (one page per call, far from the 6-minute cap); analysis runs in the browser.
- Every score shows its breakdown; facts and presumptions are kept apart; "not measured" is never counted as zero.
- Optional AI (Gemini 3.8 Flash, paid-tier key required): only folder paths and counters are sent, after explicit consent; the response is validated; 5 requests per user per day.
- Test bench: `node banc/test.js`. Setup: [DEMARRAGE.md](DEMARRAGE.md) (French).

Developed by [Fabrice Faucheux](https://faucheux.bzh) — Repository: [github.com/FabriceFx/drive-organizer-gas](https://github.com/FabriceFx/drive-organizer-gas)  
Licensed under **Elastic License 2.0** — see [LICENSE](LICENSE).
