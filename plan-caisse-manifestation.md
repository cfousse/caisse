# Caisse de manifestation — Plan du projet

*Version 13 — plusieurs tablettes synchronisées (Firebase), diagnostic de synchronisation*

> **Où en est le projet.** L'application à une tablette est construite, testée et livrée (fichier `caisse-manifestation.zip`). Ce plan décrit l'ensemble du projet ; le passage à plusieurs tablettes (partie 7) est construit et testé sur une simulation de Firebase ; il reste à le valider sur votre vrai projet (voir 7.8 et 7.10).

## 1. Objectif

Une application de caisse simple pour une tablette Android, utilisée lors des manifestations :

- préparer à l'avance les produits à vendre et le stock, pour une ou plusieurs manifestations ;
- faire fonctionner plusieurs tablettes en même temps, sur le même stock et les mêmes ardoises ;
- encaisser rapidement : on touche les produits, on valide, on choisit le mode de paiement (CB, espèces ou ardoise bénévole), l'appli calcule la monnaie à rendre ;
- indiquer à la personne en caisse les tickets à remettre au client, qu'il échangera ensuite au bar ;
- tenir une ardoise par bénévole, avec un crédit offert en euros déduit de sa facture, réglée en fin de manifestation ;
- obtenir un bilan à la fin de chaque manifestation ;
- garder l'historique d'une année sur l'autre.

Contraintes : aucun coût d'hébergement, fonctionnement même sans réseau, un seul tiroir-caisse même avec plusieurs tablettes.

---

## 2. Stack technique

| Élément | Choix | Pourquoi |
|---|---|---|
| Application | Page web installable (PWA) en HTML, CSS et JavaScript, sans framework | Simple à maintenir, rien à compiler |
| Données | IndexedDB (base intégrée au navigateur de la tablette) | Pas de serveur, fonctionne hors ligne |
| Hors ligne | Service worker qui met l'appli en cache | La caisse marche même si la 4G sature |
| Hébergement | GitHub Pages | Gratuit, sans limite de durée |
| Installation | « Ajouter à l'écran d'accueil » dans Chrome | S'ouvre en plein écran comme une appli |
| Mode kiosque | Épinglage d'écran natif d'Android | Empêche de quitter l'appli par erreur |
| Sauvegarde | Fichier de sauvegarde + export CSV, à déposer sur Google Drive | Protège l'historique si la tablette est perdue ou réinitialisée |
| Plusieurs tablettes | Firebase Firestore (offre gratuite) | Stock, ardoises et ventes partagés en direct, avec reprise après coupure réseau |

L'appli demandera au navigateur un stockage « persistant » pour limiter le risque qu'Android efface les données.

---

## 3. Organisation des données

### Catalogue de produits (commun à toutes les manifestations)
Chaque produit est saisi une seule fois et réutilisé ensuite.

- Nom (ex. *Bière pression 25 cl*)
- Catégorie (Boissons, Nourriture, Desserts…)
- Prix par défaut
- Ticket à remettre au client (voir ci-dessous)
- Couleur du bouton, pour le repérer d'un coup d'œil en caisse
- Actif / archivé (un produit qu'on ne vend plus disparaît des choix sans perdre l'historique)

### Tickets
Chaque produit est relié à un ticket. Selon les produits :

- **un ticket propre au produit** : c'est le cas par défaut, le ticket porte le nom du produit (ticket *Bière*, ticket *Saucisse*) et est créé automatiquement avec lui ;
- **un ticket partagé** par plusieurs produits : par exemple un seul ticket *Boisson* pour le Coca, l'eau, le jus de pomme et la limonade.

La liste des tickets partagés se gère dans le catalogue (ex. créer le ticket *Boisson*, puis le choisir pour chaque boisson sans alcool).

### Liste des bénévoles (commune à toutes les manifestations)
Saisie une fois, réutilisée d'une année sur l'autre.

- Nom (ou prénom + initiale)
- Actif / archivé

### Manifestation
- Nom, date(s), lieu
- Statut : **en préparation** → **en cours** → **clôturée**
- Fond de caisse en espèces au départ
- Produits vendus ce jour-là, avec pour chacun :
  - le prix (repris du catalogue, modifiable pour cette manifestation uniquement)
  - le stock de départ
- Bénévoles présents, avec pour chacun un **crédit offert en euros** (un montant par défaut pour tous, ex. 10 €, ajustable personne par personne)

### Vente
- Date et heure
- Articles, quantités et prix
- Total
- Mode de paiement :
  - **CB**
  - **Espèces** : montant reçu et monnaie rendue
  - **Ardoise** : bénévole concerné
- Tablette qui a encaissé (Caisse 1, Caisse 2…), quand il y en a plusieurs
- Possibilité d'annuler une vente saisie par erreur (elle reste visible, barrée, et n'est pas comptée)

### Ardoise d'un bénévole
- Toutes les commandes passées sur l'ardoise pendant la manifestation
- Montant à payer = total des commandes − crédit offert (jamais en dessous de 0 €)
- Le crédit non utilisé est perdu, il n'est ni remboursé ni reporté sur une autre manifestation
- Règlement en fin de manifestation, en CB ou en espèces (ce paiement s'ajoute aux totaux CB / espèces de la journée)
- Statut : ouverte, réglée, ou laissée impayée (avec une note)

### Réassort
Ajout de stock pendant une manifestation (ex. 2 fûts de plus sortis de la réserve), enregistré avec l'heure.

Le **stock restant** est calculé : stock de départ + réassorts − quantités vendues (tous modes de paiement confondus, ardoises comprises).

---

## 4. Les écrans

### 4.1 Accueil
- Manifestation en cours (bouton « Ouvrir la caisse »)
- Manifestations à venir, en préparation
- Accès au catalogue, aux bénévoles, à l'historique et à la sauvegarde

### 4.2 Catalogue de produits
- **Catégories gérées comme les tickets partagés** : section « Catégories » du catalogue avec « Nouvelle catégorie », « Renommer » et « Supprimer » (seulement si aucun produit n'y est rattaché). Une catégorie peut être créée à l'avance, sans produit. Renommer met à jour tous les produits (archivés compris) ; renommer vers le nom d'une catégorie existante fusionne les deux. Les doublons (majuscules ignorées) sont refusés.
- Liste des produits par catégorie, triés par ordre alphabétique dans chaque catégorie (catalogue, préparation, caisse, exports)
- Ajout rapide : une ligne de saisie (nom, catégorie, prix, ticket) et la touche Entrée enchaîne sur le produit suivant ; la catégorie se choisit dans une liste déroulante des catégories gérées (comme le ticket) ; il n'y a plus de création à la volée, on crée d'abord la catégorie dans la section « Catégories » ; même principe à la modification d'un produit et à l'ajout d'un produit en cours de manifestation ; le ticket est par défaut celui du produit, on choisit un ticket partagé dans une liste si besoin
- Gestion des tickets partagés (créer, renommer, voir quels produits les utilisent)
- Modification et archivage d'un produit

### 4.3 Bénévoles
- Liste des bénévoles, ajout rapide d'un nom à la suite de l'autre
- Archivage de ceux qui ne viennent plus

### 4.4 Préparer une manifestation
Pensé pour être fait à l'avance, tranquillement, pour plusieurs manifestations.

- Créer une manifestation (nom, date, lieu, fond de caisse)
- **Dupliquer une manifestation existante** : reprend ses produits, prix, stocks, bénévoles et crédits (ex. préparer la *Fête de la bière 2027* à partir de l'édition 2026)
- Cocher les produits du catalogue à vendre
- Saisir le stock de départ dans un tableau, produit par produit, avec passage automatique à la ligne suivante
- Ajuster un prix pour cette manifestation seulement
- **Réassort d'un produit dont le stock n'était pas suivi** : la quantité saisie devient le stock « maintenant » et le suivi démarre à cet instant (les ventes déjà faites ne sont pas décomptées). Exemple : je saisis 12 bières, il en reste 12, puis 9 après une vente de 3. Les réassorts suivants s'ajoutent normalement.
- Cocher les bénévoles présents et fixer leur crédit offert (montant par défaut pour tous, puis exceptions) ; boutons **Tout sélectionner** et **Tout retirer** (un bénévole qui a déjà consommé reste dans la manifestation)
- Un bénévole imprévu peut aussi être ajouté le jour même : bouton « Nouveau bénévole » au moment de payer sur ardoise, ou champ « Ajouter un bénévole » de l'écran Préparation (il reçoit le crédit par défaut)

### 4.5 Caisse (écran principal pendant la manifestation)
- Grille de gros boutons colorés, regroupés par catégorie, adaptée au tactile. Sur téléphone (écran étroit), boutons, claviers et textes sont plus compacts (3 produits par ligne) ; la tablette garde les grandes tailles. Sur téléphone, la barre du haut est réduite : Caisse, Suivi, Ardoises, Bilan et Préparation passent dans un menu à trois traits, et l'état de la synchronisation devient un simple rond (vert : tout est envoyé, bleu : envoi en cours, orange : hors ligne, rouge : problème ; toucher le rond ouvre l'écran Synchronisation).
- Sur chaque bouton : nom, prix, stock restant ; le bouton passe en orange quand le stock est bas et devient grisé à zéro
- Un toucher ajoute une unité au panier
- Panier sur le côté : quantités modifiables (+ / −), suppression d'une ligne, bouton « Vider »
- Total en grand, bouton **Encaisser**

### 4.6 Paiement
Trois gros boutons : **CB**, **Espèces**, **Ardoise**.

- **CB** : on valide une fois le paiement passé sur le terminal
- **Espèces** : saisie du montant reçu avec un pavé numérique et des raccourcis (5 €, 10 €, 20 €, 50 €, « Compte juste ») ; la **monnaie à rendre** s'affiche en très grand
- **Ardoise** : choix du bénévole dans une liste de gros boutons (avec recherche) ; l'appli affiche son crédit restant et ce que cette commande ajoute à son ardoise
- Validation : la vente est enregistrée, le stock mis à jour

### 4.7 Tickets à remettre
Juste après la validation du paiement, quel que soit le mode :

- l'écran affiche en grand la liste des tickets à donner au client, regroupés par ticket : une commande de 3 bières, 1 Coca, 1 eau et 2 saucisses donne *3 × Bière, 2 × Boisson, 2 × Saucisse*
- un bouton **Commande suivante** vide le panier et revient à la caisse
- en espèces, la monnaie à rendre reste affichée sur ce même écran, pour tout faire d'un coup

### 4.8 Suivi pendant la manifestation
- Dernières ventes, avec possibilité d'en annuler une
- Ajout d'un réassort
- **Ajout d'un produit en cours de manifestation** : bouton « + Produit » à côté de « Réassort ». Une seule fenêtre :
  - soit on choisit un produit du catalogue qui n'est pas encore dans la manifestation (son prix habituel est repris, modifiable) ;
  - soit on en crée un nouveau (nom, catégorie, prix, ticket remis).
  - Dans les deux cas on indique la quantité en stock **maintenant** (ou on la laisse vide pour ne pas suivre le stock) ; le suivi démarre à cet instant, comme pour le réassort d'un produit non suivi.
  - Le produit apparaît aussitôt à la caisse, sur toutes les tablettes si la synchronisation est active, et reste dans le catalogue pour les prochaines manifestations.
  - La grille de la caisse n'est pas modifiée : pas de bouton d'ajout au milieu de la file d'attente.
- Totaux en cours (CB / espèces / ardoises)
- Vue des ardoises : pour chaque bénévole, total consommé, crédit restant, montant dû à l'instant

### 4.9 Règlement des ardoises
Accessible à tout moment (un bénévole qui part plus tôt peut régler) et proposé automatiquement avant la clôture.

- Détail de l'ardoise du bénévole : commandes, crédit déduit, montant à payer
- Règlement en CB ou en espèces (avec calcul de la monnaie à rendre)
- Possibilité de laisser une ardoise impayée avec une note (elle reste signalée dans le bilan et l'historique)

### 4.10 Clôture et bilan
- Vérification que toutes les ardoises sont réglées ou explicitement laissées impayées
- Comptage de la caisse : on saisit les espèces réellement présentes, l'appli affiche l'écart avec le montant théorique (fond de caisse + ventes en espèces + ardoises réglées en espèces)
- Bilan :
  - total encaissé, total CB, total espèces, nombre de ventes, panier moyen
  - nombre de tickets remis, par ticket
  - bénévoles : total consommé, crédit offert utilisé, ardoises réglées, montant impayé
  - par produit : quantité vendue, chiffre d'affaires, stock de départ, stock restant, avec la répartition par mode de paiement
  - répartition des ventes par heure (pour repérer les heures de rush)
- Export CSV du bilan, à ouvrir dans Excel ou LibreOffice

### 4.11 Historique
- Liste de toutes les manifestations clôturées, consultables à tout moment
- Comparaison entre deux éditions (ex. 2025 et 2026) : chiffre d'affaires, ventes par produit, répartition CB / espèces / bénévoles
- Liste des ardoises restées impayées, toutes manifestations confondues

### 4.12 Sauvegarde et restauration
- **Sauvegarder** : génère un fichier contenant tout (catalogue, bénévoles, manifestations, ventes, ardoises), à déposer sur Google Drive
- **Restaurer** : recharge ce fichier sur une nouvelle tablette
- Rappel automatique de sauvegarder à chaque clôture, et si la dernière sauvegarde date de plus de 30 jours

---

## 5. Déroulé type

1. **Quelques semaines avant** : compléter le catalogue et la liste des bénévoles, créer la manifestation (ou dupliquer celle de l'an dernier), saisir les stocks et les crédits des bénévoles.
2. **Le jour J** : ouvrir la manifestation, vérifier le fond de caisse, épingler l'écran, vendre. Avec plusieurs tablettes, chacune se connecte au compte partagé et porte son nom (Caisse 1, Caisse 2…).
3. **Pendant** : encaisser en CB ou en espèces, remettre les tickets affichés, passer les commandes des bénévoles sur leur ardoise, ajouter un réassort si besoin, annuler une vente erronée.
4. **À la fin** : régler les ardoises, compter l'unique tiroir-caisse, clôturer depuis une seule tablette, consulter le bilan, sauvegarder sur Google Drive.
5. **L'année suivante** : dupliquer la manifestation et comparer les éditions dans l'historique.

---

## 6. Étapes de réalisation — application à une tablette (fait)

1. **Base** : structure de l'appli, base de données, fonctionnement hors ligne, installation sur la tablette
2. **Catalogue, bénévoles et préparation** des manifestations (avec duplication)
3. **Caisse et paiement** (panier, CB / espèces, monnaie à rendre, stock, tickets à remettre)
4. **Ardoises des bénévoles** : passage en ardoise, crédit offert, règlement
5. **Suivi** : dernières ventes, annulation, réassort
6. **Clôture et bilan**, export CSV
7. **Historique** et comparaison entre éditions
8. **Sauvegarde / restauration**
9. **Mise en ligne** sur GitHub Pages + guide d'installation sur la tablette (pas à pas, avec l'épinglage d'écran)

Un jeu de données d'exemple est fourni pour tester avant la première vraie manifestation.

Cette partie est livrée et testée : vente en espèces avec rendu de monnaie, carte, ardoise, annulation, clôture, historique, fonctionnement hors ligne et restauration d'une sauvegarde.

---

## 7. Plusieurs tablettes (construit, à tester sur votre projet Firebase)

Plusieurs personnes encaissent en même temps, mais **l'argent va dans un seul tiroir-caisse**. Les tablettes partagent donc le même stock, les mêmes ardoises et la même caisse.

### 7.1 Principe

Les données passent par **Firebase Firestore**, la base en ligne gratuite de Google. Chaque tablette garde une copie locale complète : si le réseau tombe, elle continue à encaisser normalement et les ventes partent toutes seules au retour de la connexion. Le stock est recalculé à partir de la liste des ventes, donc les ventes de plusieurs tablettes s'additionnent sans se gêner.

L'offre gratuite autorise 50 000 lectures et 20 000 écritures par jour, bien au-delà de ce que consomme une buvette. La seule chose à vérifier à la création du compte : si Google demande une carte bancaire pour ouvrir le projet (rien ne sera facturé dans cette limite).

### 7.2 Accès aux données

Les données étant en ligne, l'accès est protégé par un **compte partagé** : une adresse et un mot de passe créés dans Firebase, saisis une fois sur chaque tablette puis mémorisés. Les règles de sécurité de Firestore n'autorisent que ce compte à lire et écrire.

Si vous devez retirer l'accès à une tablette (perdue, prêtée), il suffit de changer le mot de passe dans Firebase : les autres tablettes devront le ressaisir une fois.

### 7.3 Nom de chaque tablette

À la première ouverture, chaque tablette reçoit un nom (Caisse 1, Caisse 2, Bar, Restauration…). Ce nom est enregistré avec chaque vente. Le bilan et l'export CSV donnent alors le détail par tablette : nombre de ventes, chiffre d'affaires, et surtout le montant encaissé en espèces, utile pour retrouver une erreur de rendu de monnaie.

### 7.4 Ce que voit l'utilisateur

- Un **indicateur de synchronisation** en haut de l'écran : « à jour », « 3 ventes en attente », ou « hors ligne ».
- Le **stock se met à jour tout seul** quand une autre tablette vend ; un produit épuisé se grise partout.
- Le **crédit d'un bénévole** est à jour sur toutes les tablettes, donc il ne peut pas le dépasser en commandant à deux endroits.
- La **préparation** (produits, stocks, bénévoles) se fait sur une tablette et apparaît sur les autres.

### 7.5 Ce qui se fait sur une seule tablette

- **Le comptage de la caisse et la clôture** : un seul tiroir, donc un seul comptage. L'appli compare les espèces comptées au total encaissé par toutes les tablettes réunies.
- **Le règlement d'une ardoise** : dès qu'une tablette l'a réglée, elle apparaît comme réglée sur les autres, pour éviter de faire payer deux fois le même bénévole.
- Le panier en cours reste propre à chaque tablette, évidemment.

### 7.6 Mise en place et reprise des données

- La configuration du projet Firebase est collée une fois dans le fichier `firebase-config.js` (sur GitHub). L'écran **Synchronisation** de l'appli permet ensuite de se connecter au compte partagé et de nommer la tablette.
- Un bouton **« Envoyer mes données vers le cloud »** reprend ce qui est déjà saisi sur la tablette principale (catalogue, bénévoles, historique) pour amorcer la base.
- L'application continue de fonctionner **sans Firebase** : une association qui n'a qu'une tablette n'a rien à configurer. La sauvegarde par fichier reste disponible dans les deux cas.

### 7.7 Limites à connaître

- Pendant une coupure réseau, deux tablettes peuvent chacune vendre le dernier article disponible. Le stock apparaîtra négatif à la reconnexion, et le bilan le signalera.
- Les données sont hébergées chez Google. Elles ne contiennent que des produits, des montants et des prénoms de bénévoles.
- Si Google modifie son offre gratuite, il faudra revoir ce choix. Les données peuvent être réexportées à tout moment en fichier de sauvegarde.

### 7.8 Ce que vous devrez faire vous-même

Créer le projet Firebase (compte Google, projet gratuit, activation de Firestore et du compte partagé). Le guide pas à pas est dans `GUIDE-FIREBASE.md` (sans captures d'écran). Je ne peux pas accéder à Firebase depuis mon environnement : je testerai la synchronisation sur une simulation de deux tablettes, et le premier essai avec votre vrai projet sera à faire **avant une manifestation**, pas le jour même. Je vous indiquerai précisément quoi vérifier.

### 7.9 Étapes de réalisation

1. Écran **Synchronisation** : configuration, connexion au compte partagé, nom de la tablette
2. **Envoi et réception des données** entre la tablette et Firestore, avec reprise après coupure
3. **Indicateur de synchronisation** et mise à jour automatique du stock et des ardoises
4. **Verrous** sur le règlement des ardoises et sur la clôture
5. **Détail par tablette** dans le bilan et les exports CSV
6. **Reprise des données existantes** vers le cloud
7. **Guide de création du projet Firebase** et protocole de test

### 7.10 Diagnostic de synchronisation (ajouté après le premier essai)

Premier retour d'essai : une tablette repassait « hors ligne » et des données n'arrivaient pas dans Firebase. Ajouts de la version 1.1.1 :

- Mode de connexion plus robuste pour les tablettes (« long polling » forcé), utile quand le wifi ou le navigateur bloque la liaison temps réel.
- Relance automatique de la liaison au retour du réseau et au retour de l'appli au premier plan.
- Bloc **Diagnostic** sur l'écran Synchronisation : dernier échange avec le serveur, dernière erreur d'envoi, éléments en attente, bouton **Tester l'écriture** (distingue réseau bloqué et règles de sécurité qui refusent) et bouton **Relancer la liaison**.
- La cause exacte du premier incident reste à confirmer avec le résultat du test sur la vraie tablette.

### 7.11 Connexion avec un compte Google et traçabilité

- Les membres de l'association peuvent se connecter avec leur compte Google (bouton **Se connecter avec Google** de l'écran Plusieurs tablettes). Le compte partagé reste disponible en secours.
- Les personnes autorisées sont des documents de la collection `allowed` de Firestore (ID = adresse Gmail en minuscules), gérés dans la console Firebase : l'appli ne peut pas les modifier. Les règles de sécurité n'acceptent que le compte partagé et ces adresses.
- Chaque vente, règlement d'ardoise et réassort enregistre **la caisse** (nom de la tablette) et **le compte** connecté. Le suivi affiche « (Caisse 1 · marie) », l'export CSV des ventes a une colonne « Compte ».
- Un compte Google non autorisé voit le message « Ce compte n'est pas autorisé » et aucune donnée.
- Étapes Firebase à faire : voir `GUIDE-FIREBASE.md`, partie 3 bis. À tester sur la tablette avant une manifestation (la fenêtre Google en mode application installée n'a pu être testée que sur simulation).

---

## 8. Hors périmètre pour l'instant

- Consigne des gobelets, formules et menus
- Impression des tickets (l'appli indique quels tickets papier remettre)
- Lien direct avec le terminal de paiement CB (on valide manuellement)
- Un compte par bénévole (une seule connexion partagée entre les tablettes)
- Plusieurs tiroirs-caisses séparés
