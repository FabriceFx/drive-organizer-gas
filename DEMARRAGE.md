# Démarrage

Pour l'administrateur qui déploie. Comptez dix minutes. Les utilisateurs, eux,
n'ont qu'une URL à ouvrir.

Prérequis : un compte de votre domaine Google Workspace. Aucun droit
d'administration n'est nécessaire : chacun n'analyse que son propre Drive.

## 1. Créer le projet

**Avec clasp** (depuis ce dossier) :

```bash
clasp create --type standalone --title "Rangement Drive" --rootDir apps-script
```

```bash
clasp push
```

Vérifiez ensuite, dans l'éditeur, que le fuseau du projet est **Europe/Paris** :
`clasp create` pose celui du compte Google, pas le vôtre.

**À la main** :

1. Ouvrez [script.new](https://script.new), nommez le projet « Rangement Drive ».
2. **Paramètres du projet** : cochez « Afficher le fichier manifeste », puis collez `appsscript.json`.
3. Supprimez `Code.gs`, puis recréez chaque fichier de `apps-script/` sous le même nom :

   | Fichiers | Bouton de l'éditeur |
   |---|---|
   | `*.gs` | **+ > Script** (sans l'extension dans le nom) |
   | `*.html` | **+ > HTML** (sans l'extension dans le nom) |

> ⚠️ Du HTML collé dans un fichier de script empêche **tout** le projet de se charger :
> toutes les fonctions deviennent « introuvables », y compris celles qui n'ont rien à voir.

## 2. Déclarer vos domaines secondaires (si vous en avez)

Le domaine de chaque utilisateur est reconnu automatiquement. Pour les domaines
secondaires et alias, exécutez une fois depuis l'éditeur :

```js
rangementDefinirDomainesInternes('filiale.fr, ancienne-marque.com')
```

Sans cela, un collègue sur un domaine secondaire passe pour un externe : il ne
compte pas dans le score, et ses fichiers passent pour des fichiers que Google
refusera de déplacer.

## 3. Déployer

**Déployer > Nouveau déploiement > Application Web** :

| Champ | Valeur |
|---|---|
| Exécuter en tant que | **L'utilisateur qui accède à l'application Web** |
| Qui a accès | **Tous les utilisateurs de votre domaine** |

Ouvrez l'URL `/exec`, autorisez, lancez une analyse sur votre propre Drive. Puis diffusez l'URL.

## 4. Activer l'option IA (facultatif)

1. Créez une clé sur [aistudio.google.com](https://aistudio.google.com) (rubrique *API keys*), dans un projet Google Cloud **dont la facturation est activée**.

   > ⚠️ **Pas de clé du niveau gratuit.** D'après les [conditions de l'API Gemini](https://ai.google.dev/gemini-api/terms), Google se sert des requêtes gratuites pour améliorer ses produits, et des personnes peuvent les relire. Sur le niveau payant, il ne les conserve que le temps de détecter les abus. Des noms de dossiers d'entreprise relèvent du second cas. L'outil ne peut pas vérifier le niveau de la clé : c'est à vous.

   Restreignez la clé à la seule *Generative Language API* (console Google Cloud > Identifiants). C'est l'organisation qui paie : 5 demandes au plus par personne et par jour.
2. **Paramètres du projet > Propriétés du script > Ajouter** : nom `RANGEMENT_CLE_GEMINI`, valeur la clé.

   Passez par cet écran plutôt que par le code : une clé tapée dans un fichier finit dans l'historique des versions, lisible par tout éditeur du projet.

3. Rechargez l'application : l'onglet « Proposition IA » propose l'envoi.

Pour désactiver : supprimez la propriété, ou exécutez `rangementDefinirCleIa('')`.

## 5. Le rangement, côté utilisateur

1. Onglet **Hiérarchie proposée** : **Préparer le plan**. Un classeur « Plan de rangement Drive » apparaît dans le dossier *Rangement Drive — plans* de son Drive.
2. Dans Sheets, cocher **Valider** sur les lignes approuvées ; corriger une Destination si besoin. Rien n'est coché d'office.
3. Onglet **Application** : relire le décompte, confirmer, suivre. La fenêtre peut se fermer : l'application continue en arrière-plan.
4. Faire glisser dans Drive les dossiers listés « À faire vous-même », puis **Vérifier les déplacements**.
5. Pour revenir en arrière : **Annuler ce plan**, dans l'onglet Application. Un plan inverse s'écrit ; on le relit, on coche, on applique. L'onglet *À défaire dans Drive* liste ce que l'outil ne défait pas lui-même.

Le premier « Préparer le plan » redemande l'autorisation : l'outil demande désormais
d'écrire dans Drive et dans Sheets (voir [les portées](README.md#portées-demandées)).

## 6. Mettre à jour

Après un `clasp push` ou une modification : **Gérer les déploiements > modifier > Version : nouvelle version**.

> **Passage de la v0.1 à la v0.2** : les portées changent (`drive` au lieu de
> `drive.readonly`, plus `spreadsheets` et `script.scriptapp`). Chaque utilisateur
> verra de nouveau l'écran d'autorisation Google à sa prochaine visite : prévenez-les,
> un écran inattendu qui demande « voir, modifier, créer et supprimer vos fichiers »
> inquiète à juste titre. Le README dit ce que l'outil en fait, et ce qu'il n'en fait pas.

L'URL `/exec` sert la version déployée, figée ; l'URL `/dev` sert le code courant. Si
l'une marche et pas l'autre, c'est qu'il manque ce redéploiement. Le pied de page de
l'application affiche le numéro de version qui tourne.

## En cas de souci

| Situation | Que faire |
|---|---|
| « Fonction de script introuvable » | Redéployez une nouvelle version (ci-dessus). Si rien ne marche, même dans `/dev`, un fichier ne se charge pas : vérifiez qu'aucun HTML n'a été collé dans un `.gs`. |
| La lecture s'interrompt | Le bouton « Reprendre la lecture » repart de la dernière page lue. |
| Analyse arrêtée en cours | Un bandeau le dit : des dossiers peuvent paraître vides ou orphelins faute d'avoir été lus. |
| Bandeau « certaines données n'ont pas pu être lues » | Les résultats qui en dépendent sont marqués « non mesuré ». Relancez plus tard. |
| Ligne « Échec » : *pas pu être créé* (Drive partagé) | L'organisation interdit peut-être la création de Drives partagés (console d'administration > Applications > Google Workspace > Drive et Docs > Paramètres de partage > Création de Drive partagé). Autorisez-la, ou créez le Drive vous-même et préparez un nouveau plan. |
| Ligne « Échec » : *déplacé depuis la préparation* | Voulu : l'outil ne déplace pas sur la foi d'un plan périmé. Relancez une analyse pour un plan à jour. |
| « Une application de plan est en cours » en préparant un plan | Une passe tourne encore (autre onglet, ou arrière-plan). Attendez la fin, ou **Arrêter** dans l'onglet Application. |
| Annulation : lignes « écartées, dossier renommé ou supprimé » | Le dossier où le rangement avait mis ces éléments n'existe plus sous ce nom : remettez-les à la main, ou rendez son nom au dossier et préparez de nouveau l'annulation. |
| Application figée sur « une autre application tourne » | Un autre onglet ou le déclencheur de reprise travaille. Attendez, ou **Arrêter** puis relancez. |
| Erreur « imprévue » avec une référence | Cherchez l'heure de la référence dans **Exécutions** de l'éditeur : le détail technique y est. |
