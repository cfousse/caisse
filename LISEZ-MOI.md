# Caisse manifestation — guide de mise en ligne et d'installation

L'application est un petit site (HTML, CSS, JavaScript) qui s'installe sur la tablette comme une appli et fonctionne sans réseau. Les données restent sur la tablette ; GitHub ne sert qu'à héberger le code.

## 1. Mettre le site en ligne (gratuit, une seule fois)

1. Créez un compte gratuit sur **github.com**.
2. Cliquez sur **New repository** (bouton « + » en haut à droite). Nom : `caisse`. Laissez **Public** (c'est obligatoire pour GitHub Pages gratuit, sans risque : le site ne contient aucune donnée). Validez avec **Create repository**.
3. Sur la page du dépôt, cliquez sur **uploading an existing file**, puis glissez-y **tout le contenu** du dossier décompressé (`index.html`, `app.js`, `style.css`, `sw.js`, `manifest.webmanifest` et le dossier `icons`). Validez avec **Commit changes**.
4. Allez dans **Settings → Pages**. Sous « Build and deployment », choisissez **Deploy from a branch**, branche **main**, dossier **/ (root)**, puis **Save**.
5. Après une à deux minutes, l'adresse du site s'affiche en haut de cette page : `https://VOTRE-NOM.github.io/caisse/`.

## 2. Installer sur la tablette Android

1. Avec **Chrome**, ouvrez l'adresse du site (avec du réseau).
2. Menu ⋮ → **Ajouter à l'écran d'accueil** (ou **Installer l'application**).
3. Ouvrez l'appli depuis l'icône : elle se lance en plein écran. Faites-le une première fois **avec du réseau** : c'est à ce moment que l'appli se met en mémoire pour fonctionner hors ligne.
4. Vérifiez : passez la tablette en mode avion et relancez l'appli, elle doit s'ouvrir normalement.

## 3. Empêcher de quitter l'appli (mode kiosque)

Paramètres Android → Sécurité (ou Écran de verrouillage) → **Épinglage d'écran** → activer, avec demande du code de déverrouillage. Ensuite, dans la liste des applications récentes, touchez l'icône de l'appli → **Épingler**. Pour quitter : maintenir ensemble les boutons Retour et Aperçu (ou glisser vers le haut en maintenant, selon la tablette).

## 4. Utilisation

1. **Catalogue** : ajoutez les produits (nom, catégorie, prix, ticket). Entrée enchaîne sur le produit suivant. Pour un ticket partagé (ex. « Boisson »), créez-le dans « Tickets partagés » puis choisissez-le dans la liste « Ticket ».
2. **Bénévoles** : saisissez les noms une fois.
3. **Nouvelle manifestation** : nom, date, puis cochez les produits, saisissez les stocks, fixez le crédit offert des bénévoles. Pour une nouvelle édition, utilisez **Dupliquer** (ou « Partir d'une manifestation existante »).
4. **Ouvrir la caisse**, puis vendre : touchez les produits, **Encaisser**, choisissez CB, Espèces (monnaie calculée) ou Ardoise bénévole. L'écran suivant indique les tickets à remettre.
5. **Fin de manifestation** : onglet **Ardoises** pour les régler, onglet **Bilan** pour compter la caisse et **Clôturer**.
6. **Sauvegarder** : accueil → Sauvegarde → « Envoyer (Drive, mail…) ».

## 5. Sauvegardes : à ne pas oublier

Les données ne sont que sur la tablette. Si elle est perdue, réinitialisée, ou si les données du navigateur sont effacées, tout disparaît. Faites une sauvegarde **à la fin de chaque manifestation** (l'appli vous le rappelle) et déposez le fichier sur Google Drive. Pour retrouver vos données sur une autre tablette : Sauvegarde → Restaurer.

## 6. Mettre à jour l'application

Remplacez les fichiers sur GitHub (Add file → Upload files). Pour que les tablettes récupèrent la nouvelle version, changez aussi le numéro `CACHE = 'caisse-v1.1.0'` dans `sw.js` (par exemple `caisse-v1.1.1`). La nouvelle version se charge à la prochaine ouverture de l'appli avec du réseau. Les données ne sont pas touchées.

## 7. Essayer avant la première manifestation

Sur l'accueil, « Charger un jeu d'exemple » crée des produits, des bénévoles et une manifestation de test. Pour tout retirer ensuite : Sauvegarde → Tout effacer.

## 8. Plusieurs tablettes (facultatif)

Par défaut l'appli fonctionne sur une seule tablette, sans rien configurer. Pour partager catalogue, stocks, ventes et ardoises entre plusieurs caisses, suivez **GUIDE-FIREBASE.md** (Firebase, gratuit). Fichiers concernés : `firebase-config.js` (votre configuration), `sync.js` et `sync-firebase.js` (ne pas modifier).
