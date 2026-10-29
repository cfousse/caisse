'use strict';
/* Moteur de synchronisation entre tablettes.
   - Les données restent d'abord dans IndexedDB (app.js). Ce moteur les réplique vers Firebase Firestore.
   - Chaque enregistrement est envoyé sous forme de différence champ par champ : deux tablettes qui
     modifient des champs différents du même document ne s'écrasent pas.
   - Les ventes ne sont écoutées en direct que pour les manifestations non terminées (économie de lectures).
   - Le connecteur Firebase (sync-firebase.js) est chargé à la demande ; sans configuration, rien ne change. */
const Sync = (() => {
  const DELETE = '__DELETE__';
  const COLS = ['products', 'tickets', 'volunteers', 'events'];
  const ALL = COLS.concat('sales');
  const st = { adapter: null, loading: false, error: '', user: null, authKnown: false, started: false,
    fromCache: {}, firstSeen: {}, situation: null, probing: false, probeError: '' };
  const shadow = {}, remoteLast = {}, snapPending = new Set(), inflight = new Map();
  const pulling = new Set();
  let unsubs = [], salesUnsub = null, salesKey = '', reconciling = false;

  /* ---------- utilitaires ---------- */
  const key = (store, id) => store + '/' + id;
  const clone = o => (o === undefined ? undefined : JSON.parse(JSON.stringify(o)));
  const isObj = o => o !== null && typeof o === 'object' && !Array.isArray(o);
  function stable(o) {
    if (o === null || typeof o !== 'object') return JSON.stringify(o);
    if (Array.isArray(o)) return '[' + o.map(stable).join(',') + ']';
    return '{' + Object.keys(o).filter(k => o[k] !== undefined).sort().map(k => JSON.stringify(k) + ':' + stable(o[k])).join(',') + '}';
  }
  /* Différence entre deux états : objet imbriqué avec DELETE pour les champs supprimés, undefined si identiques. */
  function diff(a, b) {
    if (isObj(a) && isObj(b)) {
      const out = {};
      let any = false;
      Object.keys(b).forEach(k => {
        if (b[k] === undefined) return;
        const d = diff(a[k], b[k]);
        if (d !== undefined) { out[k] = d; any = true; }
      });
      Object.keys(a).forEach(k => { if (!(k in b) || b[k] === undefined) { out[k] = DELETE; any = true; } });
      return any ? out : undefined;
    }
    return stable(a) === stable(b) ? undefined : clone(b);
  }
  const meta = () => getMeta().sync || {};
  const setSyncMeta = patch => setMeta({ sync: Object.assign({}, meta(), patch) });
  const enabled = () => !!(window.__syncAdapter || (window.SYNC_CONFIG && window.SYNC_CONFIG.firebase && window.SYNC_CONFIG.firebase.apiKey));
  const linked = () => enabled() && !!meta().linked;
  const tabletName = () => (linked() ? meta().tabletName || '' : '');
  const dirtyMap = () => meta().dirty || {};
  const isDirty = k => !!dirtyMap()[k];
  function markDirty(k) { if (!isDirty(k)) setSyncMeta({ dirty: Object.assign({}, dirtyMap(), { [k]: 1 }) }); }
  function clearDirty(k) { if (isDirty(k)) { const d = Object.assign({}, dirtyMap()); delete d[k]; setSyncMeta({ dirty: d }); } }
  const pendingCount = () => new Set([...inflight.keys(), ...snapPending, ...Object.keys(dirtyMap())]).size;
  const canPush = () => !!(st.started && st.user && st.adapter);
  const onlineNow = () => navigator.onLine !== false;
  function offline() {
    if (!onlineNow()) return true;
    const v = Object.values(st.fromCache);
    return st.started && v.length > 0 && v.every(Boolean);
  }
  function normalize(store, d) {
    if (store === 'events') ['products', 'volunteers', 'tabs', 'restocks'].forEach(k => { if (!isObj(d[k])) d[k] = {}; });
    if (store === 'sales' && !Array.isArray(d.lines)) d.lines = [];
    return d;
  }

  /* ---------- affichage différé : jamais pendant un appui ou une saisie ---------- */
  let renderTimer = null, pointerDown = false, deferred = false;
  const typing = () => { const a = document.activeElement; return !!a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT'); };
  function requestRender() {
    if (renderTimer) return;
    renderTimer = setTimeout(() => {
      renderTimer = null;
      if (pointerDown || typing()) { deferred = true; return; }
      render();
    }, 200);
  }
  document.addEventListener('pointerdown', () => { pointerDown = true; }, true);
  ['pointerup', 'pointercancel'].forEach(t => document.addEventListener(t, () => {
    pointerDown = false;
    if (deferred) { deferred = false; requestRender(); }
  }, true));
  document.addEventListener('focusout', () => { if (deferred) { deferred = false; setTimeout(requestRender, 80); } }, true);

  /* ---------- état affiché ---------- */
  function state() {
    let phase;
    if (!enabled()) phase = 'off';
    else if (!linked()) phase = 'idle';
    else if (st.error && !st.adapter) phase = 'error';
    else if (!st.adapter || !st.authKnown) phase = 'connecting';
    else if (!st.user) phase = 'signedout';
    else phase = offline() ? 'offline' : 'online';
    return { phase, user: st.user, linked: linked(), pending: pendingCount(), error: st.error, loading: st.loading, authKnown: st.authKnown };
  }
  function pillInfo() {
    const s = state(), n = s.pending;
    switch (s.phase) {
      case 'connecting': return { cls: 'wait', text: 'Connexion…' };
      case 'signedout': return { cls: 'bad', text: 'Non connecté' };
      case 'error': return { cls: 'bad', text: 'Synchro indisponible' };
      case 'offline': return { cls: 'warn', text: n ? `Hors ligne · ${n} en attente` : 'Hors ligne' };
      case 'online': return n ? { cls: 'wait', text: `Envoi… ${n}` } : { cls: 'ok', text: 'Synchronisé' };
      default: return { cls: 'wait', text: '' };
    }
  }
  function updatePill() {
    const p = pillInfo();
    document.querySelectorAll('.syncpill').forEach(el => { el.textContent = p.text; el.className = 'syncpill ' + p.cls; });
  }
  function changed() {
    updatePill();
    if (location.hash.startsWith('#/sync')) requestRender();
  }
  window.addEventListener('online', () => { changed(); pullClosed(); reconcile(); });
  window.addEventListener('offline', changed);
  /* Relance la liaison quand l'appli revient au premier plan ou que le réseau revient. */
  async function reconnect() { try { if (st.adapter && st.adapter.reconnect) await st.adapter.reconnect(); } catch (e) { /* ignoré */ } changed(); reconcile(); }
  window.addEventListener('online', () => reconnect());
  document.addEventListener('visibilitychange', () => { if (!document.hidden && st.started) reconnect(); });
  async function test() {
    st.testResult = 'Test en cours…'; changed();
    try { await st.adapter.ping(tabletName()); st.testResult = 'Écriture acceptée par le serveur : la liaison fonctionne.'; }
    catch (e) {
      const c = (e && (e.code || e.message)) || 'erreur';
      st.testResult = c === 'timeout' ? 'Le serveur ne répond pas (délai dépassé) : réseau ou pare-feu qui bloque Google.'
        : /permission/.test(c) ? 'Écriture REFUSÉE par les règles de sécurité (permission-denied) : vérifiez l’adresse dans les règles.' : 'Échec : ' + c;
    }
    changed();
  }
  const diag = () => ({ lastContact: st.lastContact || 0, lastErr: st.lastErr || '', testResult: st.testResult || '', pending: Object.keys(dirtyMap()).concat([...inflight.keys()]) });

  /* ---------- connecteur et authentification ---------- */
  async function ensureAdapter() {
    if (st.adapter || st.loading || st.error || !enabled()) return st.adapter;
    st.loading = true; st.error = ''; changed();
    try {
      const factory = window.__syncAdapter || (await import('./sync-firebase.js')).create;
      st.adapter = await factory(window.SYNC_CONFIG);
      st.adapter.onAuth(onAuth);
    } catch (e) {
      console.error(e);
      st.error = 'Le module de synchronisation n’a pas pu être chargé. Une connexion Internet est nécessaire la première fois.';
    }
    st.loading = false; changed();
    return st.adapter;
  }
  function onAuth(user) {
    st.authKnown = true; st.user = user;
    if (!user) stop(); else maybeStart();
    changed();
  }
  function maybeStart() { if (linked() && st.user && st.adapter && !st.started) start(); }
  function init() {
    if (!enabled()) return;
    if (linked()) ensureAdapter();
  }

  /* ---------- démarrage et arrêt ---------- */
  function start() {
    if (st.started) return;
    st.started = true;
    ALL.forEach(store => Object.values(S[store]).forEach(o => { shadow[key(store, o.id)] = clone(o); }));
    COLS.forEach(col => {
      unsubs.push(st.adapter.watch(col, snap => onSnap(col, col, snap), err => onWatchError(col, err)));
    });
    refreshSalesWatch();
    changed();
  }
  function stop() {
    unsubs.forEach(u => { try { u(); } catch (e) { /* ignoré */ } });
    unsubs = [];
    if (salesUnsub) { try { salesUnsub(); } catch (e) { /* ignoré */ } salesUnsub = null; }
    salesKey = '';
    st.started = false; st.fromCache = {}; st.firstSeen = {};
  }
  function onWatchError(col, err) {
    console.warn('Synchronisation : erreur sur ' + col, err);
    st.error = 'Erreur de synchronisation (' + (err && err.code ? err.code : 'inconnue') + ').';
    changed();
  }
  function onSnap(store, label, snap) {
    st.firstSeen[label] = true;
    st.fromCache[label] = !!snap.fromCache;
    if (!snap.fromCache) st.lastContact = Date.now();
    if (st.error && !st.fromCache[label]) st.error = '';
    applyChanges(store, snap.changes);
    changed();
    if (COLS.every(c => st.firstSeen[c])) reconcile();
  }

  /* ---------- réception des changements distants ---------- */
  function applyChanges(store, changes) {
    let data = false;
    changes.forEach(c => {
      const k = key(store, c.id);
      if (c.type === 'removed') {
        delete remoteLast[k]; snapPending.delete(k);
        if (store === 'sales') return;                  // une vente sortie de la requête n'est pas supprimée
        if (inflight.has(k) || isDirty(k)) return;      // écriture locale en cours ou refusée : on garde la version locale
        delete shadow[k];
        if (S[store][c.id]) { delLocal(store, c.id); data = true; }
        return;
      }
      if (c.pending) snapPending.add(k); else snapPending.delete(k);
      if (c.pending && !(c.data && c.data.id)) return;   // document partiel (écriture locale sans base connue)
      const d = normalize(store, Object.assign({}, c.data, { id: c.id }));
      remoteLast[k] = d;
      if (isDirty(k) || (inflight.has(k) && !c.pending)) return; // reprise à la fin de l'envoi (voir settle)
      shadow[k] = clone(d);
      if (S[store][c.id] && stable(S[store][c.id]) === stable(d)) return;
      putLocal(store, d); data = true;
    });
    if (data) {
      if (store === 'events') { refreshSalesWatch(); pullClosed(); }
      requestRender();
    }
  }

  /* Les ventes ne sont écoutées que pour les manifestations ouvertes ou en préparation. */
  function refreshSalesWatch() {
    if (!st.started) return;
    const ids = Object.values(S.events).filter(e => e.status !== 'closed').map(e => e.id).sort();
    const k = ids.join(',');
    if (k === salesKey) return;
    salesKey = k;
    if (salesUnsub) { try { salesUnsub(); } catch (e) { /* ignoré */ } salesUnsub = null; }
    Object.keys(st.fromCache).filter(l => l.startsWith('sales')).forEach(l => { delete st.fromCache[l]; delete st.firstSeen[l]; });
    if (!ids.length) return;
    salesUnsub = st.adapter.watchSales(ids, (snap, idx) => onSnap('sales', 'sales:' + idx, snap), err => onWatchError('sales', err));
  }
  /* Une manifestation terminée n'est plus écoutée : on récupère ses ventes une fois à sa clôture. */
  async function pullClosed() {
    if (!st.started || !onlineNow()) return;
    for (const ev of Object.values(S.events)) {
      if (ev.status !== 'closed') continue;
      const marker = ev.closedAt || 'closed';
      if ((meta().pulled || {})[ev.id] === marker || pulling.has(ev.id)) continue;
      pulling.add(ev.id);
      try {
        const docs = await st.adapter.pullSales(ev.id);
        applyChanges('sales', docs.map(d => ({ type: 'added', id: d.id, data: d.data, pending: false })));
        setSyncMeta({ pulled: Object.assign({}, meta().pulled || {}, { [ev.id]: marker }) });
      } catch (e) { console.warn('Récupération des ventes impossible pour l’instant', e); }
      pulling.delete(ev.id);
    }
  }

  /* ---------- envoi des changements locaux ---------- */
  function onSave(store, obj) {
    if (!linked() || !ALL.includes(store)) return;
    const k = key(store, obj.id);
    if (!canPush()) { markDirty(k); changed(); return; }
    const patch = diff(shadow[k], obj);
    if (patch === undefined) return;
    shadow[k] = clone(obj);
    send(k, () => st.adapter.push(store, obj.id, patch));
  }
  function onDelete(store, id) {
    if (!linked() || !ALL.includes(store)) return;
    const k = key(store, id);
    delete shadow[k]; delete remoteLast[k];
    if (!canPush()) { markDirty(k); changed(); return; }
    send(k, () => st.adapter.remove(store, id));
  }
  function send(k, fn) {
    inflight.set(k, (inflight.get(k) || 0) + 1);
    changed();
    const done = () => { const n = (inflight.get(k) || 1) - 1; if (n) inflight.set(k, n); else inflight.delete(k); };
    Promise.resolve().then(fn).then(() => {
      done();
      if (!inflight.has(k)) settle(k);
      changed();
    }).catch(e => {
      console.warn('Envoi refusé, sera renvoyé plus tard', e);
      st.lastErr = (e && (e.code || e.message)) || 'erreur';
      done(); markDirty(k); changed();
    });
  }
  /* Une fois l'envoi accepté : reprend la version du serveur reçue pendant l'envoi (modification d'une autre tablette). */
  function settle(k) {
    const i = k.indexOf('/'), store = k.slice(0, i), id = k.slice(i + 1), r = remoteLast[k];
    if (r && !isDirty(k) && S[store] && S[store][id] && stable(r) !== stable(S[store][id])) {
      shadow[k] = clone(r); putLocal(store, clone(r)); requestRender();
    }
  }
  /* Renvoie ce qui n'a pas pu partir (tablette déconnectée, envoi refusé). */
  async function reconcile() {
    if (reconciling || !canPush()) return;
    const keys = Object.keys(dirtyMap());
    if (!keys.length) return;
    reconciling = true;
    try {
      for (const k of keys) {
        const i = k.indexOf('/'), store = k.slice(0, i), id = k.slice(i + 1);
        const local = S[store] && S[store][id];
        try {
          if (!local) await st.adapter.remove(store, id);
          else {
            const patch = diff(remoteLast[k], local);
            if (patch !== undefined) await st.adapter.push(store, id, patch);
            shadow[k] = clone(local);
          }
          clearDirty(k);
        } catch (e) { console.warn('Renvoi impossible pour ' + k, e); }
      }
    } finally { reconciling = false; changed(); }
  }

  /* ---------- connexion de la tablette ---------- */
  const localEmpty = () => ['products', 'volunteers', 'events', 'sales'].every(s => !Object.keys(S[s]).length);
  const localCounts = () => ({ events: Object.keys(S.events).length, products: Object.keys(S.products).length, volunteers: Object.keys(S.volunteers).length, sales: Object.keys(S.sales).length });
  async function probe() {
    if (!st.adapter) return;
    st.probing = true; st.situation = null; st.probeError = ''; changed();
    try {
      const remoteEmpty = await st.adapter.isRemoteEmpty();
      st.situation = { remoteEmpty, localEmpty: localEmpty(), counts: localCounts() };
    } catch (e) {
      console.warn(e);
      st.probeError = 'Impossible de joindre le cloud. Vérifiez la connexion Internet puis réessayez.';
    }
    st.probing = false; changed();
  }
  function onSyncScreen() {
    ensureAdapter().then(() => {
      if (st.adapter && st.user && !linked() && !st.situation && !st.probing && !st.probeError) probe();
    });
  }
  async function link(mode, name) {
    const pulled = {};
    if (mode === 'upload') {
      const docs = [];
      ALL.forEach(store => Object.values(S[store]).forEach(o => docs.push({ store, id: o.id, data: clone(o) })));
      await st.adapter.uploadAll(docs);
      Object.values(S.events).filter(e => e.status === 'closed').forEach(e => { pulled[e.id] = e.closedAt || 'closed'; });
    } else if (mode === 'replace') {
      await clearAllStores();
    }
    setSyncMeta({ linked: true, tabletName: name.trim(), dirty: {}, pulled });
    st.situation = null; st.probeError = '';
    maybeStart(); changed();
  }
  async function unlink() {
    stop();
    inflight.clear(); snapPending.clear();
    Object.keys(shadow).forEach(k => delete shadow[k]);
    Object.keys(remoteLast).forEach(k => delete remoteLast[k]);
    setSyncMeta({ linked: false, dirty: {}, pulled: {} });
    st.situation = null; st.probeError = '';
    try { if (st.adapter) await st.adapter.signOut(); } catch (e) { /* ignoré */ }
    changed();
  }
  const setTablet = name => { setSyncMeta({ tabletName: name.trim() }); changed(); };
  const retry = () => { st.error = ''; st.probeError = ''; st.situation = null; st.adapter = null; ensureAdapter(); };

  return {
    init, enabled, linked, tabletName, state, pillInfo, updatePill, ensureAdapter, onSyncScreen,
    signIn: (email, pw) => st.adapter.signIn(email, pw), signOut: () => st.adapter.signOut(),
    probe, link, unlink, setTablet, retry, onSave, onDelete, reconnect, test, diag,
    hasAdapter: () => !!st.adapter, info: () => ({ situation: st.situation, probing: st.probing, probeError: st.probeError }),
    diff, // exposé pour les tests
  };
})();
