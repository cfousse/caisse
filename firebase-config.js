/* Configuration de la synchronisation entre tablettes (voir GUIDE-FIREBASE.md).
   Laissez « firebase » à null pour utiliser l'appli avec une seule tablette.
   Ces valeurs ne sont pas secrètes : l'accès aux données est protégé par le mot de passe du compte
   partagé et par les règles de sécurité Firestore. */
window.SYNC_CONFIG = {
  firebase: {
     apiKey: "AIzaSyAeYQkKcbvV9Y3UqVEiJxTzbRJ89QmecmU",
     authDomain: "caisse-mesanges.firebaseapp.com",
     projectId: "caisse-mesanges",
     storageBucket: "caisse-mesanges.firebasestorage.app",
     messagingSenderId: "326359291758",
     appId: "1:326359291758:web:d241039a340733a4c1137f"
   },
  // Adresse e-mail du compte partagé (facultatif : pré-remplit l'écran de connexion)
  email: '',
};
