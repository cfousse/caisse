/* Connecteur Firebase (Auth + Firestore) pour le moteur de synchronisation (sync.js).
   Le SDK est chargé depuis le CDN officiel de Google ; le service worker le garde en mémoire
   pour que l'appli redémarre sans réseau.
   Contrat attendu par sync.js : onAuth, signIn, signOut, watch, watchSales, pullSales, push, remove,
   isRemoteEmpty, uploadAll. */
import { initializeApp } from 'https://www.gstatic.com/firebasejs/13.1.0/firebase-app.js';
import { getAuth, signInWithEmailAndPassword, signInWithPopup, GoogleAuthProvider, signOut, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/13.1.0/firebase-auth.js';
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager, collection, doc, query, where, limit,
  onSnapshot, setDoc, deleteDoc, deleteField, getDocsFromServer, writeBatch, enableNetwork, disableNetwork,
} from 'https://www.gstatic.com/firebasejs/13.1.0/firebase-firestore.js';

const DELETE = '__DELETE__';
let instance = null;

/* Remplace le marqueur DELETE par la suppression de champ Firestore. */
function convert(o) {
  if (o === DELETE) return deleteField();
  if (o === null || typeof o !== 'object' || Array.isArray(o)) return o;
  const out = {};
  Object.keys(o).forEach(k => { out[k] = convert(o[k]); });
  return out;
}

function mapSnapshot(snap) {
  return {
    fromCache: snap.metadata.fromCache,
    changes: snap.docChanges({ includeMetadataChanges: true }).map(c => ({
      type: c.type, id: c.doc.id, data: c.doc.data(), pending: c.doc.metadata.hasPendingWrites,
    })),
  };
}

export function create(cfg) {
  if (instance) return instance;
  const app = initializeApp(cfg.firebase);
  const auth = getAuth(app);
  let db;
  try {
    // Copie locale persistante : les ventes restent en attente d'envoi même si l'appli est fermée hors ligne.
    db = initializeFirestore(app, {
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
      experimentalForceLongPolling: true,
    });
  } catch (e) {
    console.warn('Copie locale Firestore indisponible, mode mémoire', e);
    db = initializeFirestore(app, { experimentalForceLongPolling: true });
  }

  const watchQuery = (q, onSnap, onErr) => onSnapshot(q, { includeMetadataChanges: true }, snap => onSnap(mapSnapshot(snap)), onErr);

  instance = {
    onAuth(cb) { return onAuthStateChanged(auth, u => cb(u ? { email: u.email, uid: u.uid } : null)); },
    async signIn(email, password) { await signInWithEmailAndPassword(auth, email, password); },
    /* Connexion avec un compte Google (fenêtre surgissante). L'adresse doit figurer dans la liste « allowed » de Firestore. */
    async signInGoogle() { const prov = new GoogleAuthProvider(); prov.setCustomParameters({ prompt: 'select_account' }); await signInWithPopup(auth, prov); },
    async signOut() { await signOut(auth); },

    watch(col, onSnap, onErr) { return watchQuery(collection(db, col), onSnap, onErr); },
    /* Ventes des manifestations en cours : Firestore accepte 10 valeurs par requête « in ». */
    watchSales(eventIds, onSnap, onErr) {
      const unsubs = [];
      for (let i = 0; i < eventIds.length; i += 10) {
        const idx = i / 10;
        const q = query(collection(db, 'sales'), where('eventId', 'in', eventIds.slice(i, i + 10)));
        unsubs.push(watchQuery(q, snap => onSnap(snap, idx), onErr));
      }
      return () => unsubs.forEach(u => u());
    },
    async pullSales(eventId) {
      const snap = await getDocsFromServer(query(collection(db, 'sales'), where('eventId', '==', eventId)));
      return snap.docs.map(d => ({ id: d.id, data: d.data() }));
    },

    push(col, id, patch) { return setDoc(doc(db, col, id), convert(patch), { merge: true }); },
    remove(col, id) { return deleteDoc(doc(db, col, id)); },

    /* Relance la liaison avec le serveur sans recharger l'appli. */
    async reconnect() { try { await disableNetwork(db); } catch (e) { /* ignoré */ } await enableNetwork(db); },
    /* Test d'écriture : renvoie « ok » ou le code d'erreur (permission-denied, délai dépassé…). */
    async ping(name) {
      const w = setDoc(doc(db, '_diag', 'test'), { tablet: name || '', at: Date.now() });
      const t = new Promise((_, rej) => setTimeout(() => rej({ code: 'timeout' }), 12000));
      await Promise.race([w, t]);
    },

    async isRemoteEmpty() {
      const res = await Promise.all(['events', 'products'].map(c => getDocsFromServer(query(collection(db, c), limit(1)))));
      return res.every(s => s.empty);
    },
    async uploadAll(docs) {
      for (let i = 0; i < docs.length; i += 400) {
        const batch = writeBatch(db);
        docs.slice(i, i + 400).forEach(d => batch.set(doc(db, d.store, d.id), d.data));
        await batch.commit();
      }
    },
  };
  return instance;
}
