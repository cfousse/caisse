/* Configuration de la synchronisation entre tablettes (voir GUIDE-FIREBASE.md).
   Laissez « firebase » à null pour utiliser l'appli avec une seule tablette.
   Ces valeurs ne sont pas secrètes : l'accès aux données est protégé par le mot de passe du compte
   partagé et par les règles de sécurité Firestore. */
window.SYNC_CONFIG = {
  // Collez ici l'objet « firebaseConfig » fourni par Firebase, par exemple :
  // { apiKey: "...", authDomain: "...", projectId: "...", storageBucket: "...", messagingSenderId: "...", appId: "..." }
  firebase: null,
  // Adresse e-mail du compte partagé (facultatif : pré-remplit l'écran de connexion)
  email: '',
};
