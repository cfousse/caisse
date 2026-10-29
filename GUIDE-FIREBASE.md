# Plusieurs tablettes : mise en place de Firebase (gratuit)

Durée : environ 30 minutes, à faire **à l'avance** (pas le jour d'une manifestation).
Il vous faut un compte Google et l'appli déjà en ligne sur GitHub Pages (voir README.md).

> **À savoir avant de commencer.** La synchronisation a été testée ici sur une simulation de Firebase, pas sur un vrai projet. Le test de la partie 6 sur votre vrai projet est donc indispensable. De plus, Google peut demander une carte bancaire pour certaines offres : l'offre gratuite « Spark » devrait suffire (très au-dessus du besoin d'une buvette), mais vérifiez ce que Google affiche à la création. Si une carte est exigée et que vous ne le souhaitez pas, restez en mode une tablette.

## 1. Créer le projet

1. Allez sur https://console.firebase.google.com et connectez-vous.
2. **Créer un projet**, nom au choix (ex. `caisse-asso`). Désactivez Google Analytics (inutile).
3. Menu de gauche **Build → Firestore Database → Créer une base de données**. Choisissez un emplacement européen (ex. `eur3` ou `europe-west`), mode **production**.

## 2. Créer le compte partagé

1. **Build → Authentication → Commencer**, puis fournisseur **E-mail/Mot de passe** → activer (pas le lien magique) → Enregistrer.
2. Onglet **Users → Ajouter un utilisateur** : une adresse (ex. `caisse@votre-asso.fr`, elle peut être fictive) et un mot de passe solide. C'est le compte que toutes les tablettes utiliseront.

## 3. Règles de sécurité (important)

N'importe qui connaissant la configuration publique du projet pourrait créer un compte. Les règles ci-dessous réservent donc les données à **votre** compte partagé et aux **adresses Google que vous autorisez** (partie 3 bis).

**Firestore Database → Règles**, remplacez tout par (en mettant l'adresse de votre compte partagé) puis **Publier** :

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    function shared() {
      return request.auth != null && request.auth.token.email == 'caisse@votre-asso.fr';
    }
    function allowed() {
      return request.auth != null && request.auth.token.email_verified == true
        && exists(/databases/$(database)/documents/allowed/$(request.auth.token.email));
    }
    // Les données de la caisse. La collection « allowed » n'est pas listée : l'appli ne peut ni la lire ni la modifier.
    match /{col}/{id} {
      allow read, write: if (shared() || allowed())
        && col in ['events', 'products', 'volunteers', 'tickets', 'sales', '_diag'];
    }
  }
}
```

## 3 bis. Connexion avec un compte Google (facultatif)

Permet à chaque membre de se connecter avec son propre compte Google. Son adresse et le nom de la caisse sont alors enregistrés avec chaque vente (colonne « Compte » de l'export CSV).

1. **Authentication → Méthode de connexion → Ajouter un fournisseur → Google** : activer, choisir l'adresse d'assistance du projet, Enregistrer.
2. **Authentication → Paramètres → Domaines autorisés** : ajouter votre site, par exemple `votre-compte.github.io` (sans `https://` ni chemin).
3. **Autoriser une personne** : **Firestore Database → Données → Démarrer une collection** nommée `allowed`. Pour chaque personne, créez un document dont l'**ID est son adresse Gmail en minuscules** (ex. `marie@gmail.com`) avec un champ au choix (ex. `nom` = `Marie`). Pour retirer quelqu'un, supprimez son document.
4. Sur la tablette : écran **Plusieurs tablettes** → **Se connecter avec Google**. Si la fenêtre ne s'ouvre pas, autorisez les fenêtres surgissantes pour le site.

Un compte Google dont l'adresse n'est pas dans la liste peut se connecter, mais l'appli affiche « Ce compte n'est pas autorisé » et aucune donnée n'est lisible. Le compte partagé reste utilisable en secours.

## 4. Récupérer la configuration

1. Roue dentée à côté de « Vue d'ensemble du projet » → **Paramètres du projet**.
2. En bas, **Vos applications → icône web `</>`**, un nom, pas d'hébergement Firebase. Firebase affiche un bloc `firebaseConfig`.
3. Ouvrez `firebase-config.js` (sur GitHub, icône crayon) et collez les valeurs :

```js
window.SYNC_CONFIG = {
  firebase: { apiKey: "...", authDomain: "...", projectId: "...", storageBucket: "...", messagingSenderId: "...", appId: "..." },
  email: 'caisse@votre-asso.fr',
};
```

Ces valeurs ne sont pas secrètes : c'est le mot de passe et les règles qui protègent les données.
4. Dans `sw.js`, changez `caisse-v1.1.6` en `caisse-v1.1.7` pour que les tablettes récupèrent le nouveau fichier. Validez (Commit).

## 5. Relier les tablettes

1. Tablette 1 : ouvrez l'appli (avec réseau), rechargez deux fois pour récupérer la mise à jour. Accueil → **Plusieurs tablettes**.
2. Connectez-vous (avec Google ou avec le compte partagé), donnez un nom (« Caisse 1 »).
3. Choisissez **Envoyer mes données vers le cloud** : le catalogue, les bénévoles et l'historique de cette tablette partent dans le cloud.
4. Tablette 2 : même chose, nom « Caisse 2 », mais choisissez **Rejoindre la synchronisation** (récupère les données, n'envoie rien).
5. Pastille en haut : verte = tout est envoyé, orange = envoi en attente (hors ligne), rouge = problème (voir l'écran Synchronisation).

Pendant la liaison, **Restaurer** et **Tout effacer** sont bloqués (pour ne pas écraser les autres tablettes). Pour les utiliser, quittez d'abord la synchronisation.

## 6. Protocole de test avant la manifestation

Créez une manifestation « TEST » avec quelques produits en stock, puis :

| # | Action | Résultat attendu |
|---|---|---|
| 1 | Vente sur la tablette 1 | Le stock baisse sur la tablette 2 en quelques secondes |
| 2 | Vente sur la tablette 2 | Idem dans l'autre sens, ventes visibles des deux côtés |
| 3 | Vente sur l'ardoise d'un bénévole (tablette 1) | Crédit entamé visible sur la tablette 2 |
| 4 | Régler cette ardoise sur la tablette 2 | Elle apparaît réglée sur la tablette 1 |
| 5 | Mode avion sur la tablette 2, 2 ventes | Pastille orange « en attente » ; puis réseau rétabli : pastille verte, ventes visibles sur la tablette 1 |
| 6 | Fermer complètement l'appli en mode avion avec une vente en attente, rouvrir, remettre le réseau | La vente part toute seule |
| 7 | Bilan | Totaux identiques sur les deux tablettes, tableau « Par tablette » cohérent |
| 8 | Dans la console Firebase → Firestore | Les données apparaissent (preuve que le compte et les règles fonctionnent) |

Si un point échoue, notez lequel et ce que la pastille indique : cela suffit pour corriger. Quand tout est bon, supprimez la manifestation TEST (Cloud et tablettes se mettent à jour).

## 7. Le jour J

- Branchez les tablettes, vérifiez la pastille verte et le nom de chaque caisse.
- Une coupure réseau n'empêche pas de vendre : tout est renvoyé au retour du réseau. Avant de fermer la manifestation, vérifiez que la pastille est verte partout.
- Deux caisses hors ligne peuvent vendre le dernier article chacune : le bilan signale alors un stock négatif.
- Faites une sauvegarde (Sauvegarde → Exporter) à la fin, comme d'habitude.

## Limites de l'offre gratuite

Environ 50 000 lectures et 20 000 écritures par jour, bien au-delà d'une buvette (quelques centaines à milliers de ventes). Si Google change l'offre, l'export de sauvegarde permet de tout récupérer.

## En cas de problème

Écran **Plusieurs tablettes** → bloc **Diagnostic** : heure du dernier échange avec le serveur, dernière erreur, éléments en attente. Le bouton **Tester l'écriture** dit si le serveur répond ou si les règles de sécurité refusent ; **Relancer la liaison** reconnecte sans recharger l'appli.
