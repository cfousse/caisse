'use strict';
/* Caisse manifestation — application hors ligne (PWA), sans dépendance.
   Toutes les données restent dans IndexedDB sur la tablette. Les montants sont en centimes. */
const VERSION = '1.1.5';

/* ========== utilitaires ========== */
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const eurFmt = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });
const fmt = c => eurFmt.format((c || 0) / 100);
function parseEuro(v) {
  if (v == null) return null;
  v = String(v).replace(/\s/g, '').replace('€', '').replace(',', '.');
  if (v === '') return null;
  const n = parseFloat(v);
  return isNaN(n) ? null : Math.round(n * 100);
}
const toInput = c => (c == null ? '' : (c / 100).toFixed(2).replace('.', ','));
const pad = n => String(n).padStart(2, '0');
const localDate = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fmtDate = d => (d ? new Date(d + 'T12:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) : '');
const fmtDateTime = iso => new Date(iso).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const fmtTime = iso => new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
const byName = (a, b) => a.name.localeCompare(b.name, 'fr');
const sortProducts = (a, b) => a.category.localeCompare(b.category, 'fr') || a.name.localeCompare(b.name, 'fr') || (a.createdAt || 0) - (b.createdAt || 0);
const catPicker = (cats, cur) => cats.length ? `<div class="catpick" style="grid-column:1/-1;flex-basis:100%"><span class="muted">Catégories existantes :</span> ${cats.map(c => `<button type="button" class="chip small ${c === cur ? 'on' : ''}" data-act="pick-cat" data-v="${esc(c)}">${esc(c)}</button>`).join('')}</div>` : '';
const list = store => Object.values(S[store]);
const sum = (arr, f) => arr.reduce((a, x) => a + f(x), 0);
const COLORS = { ambre: '#b45309', rouge: '#b91c1c', rose: '#be185d', violet: '#6d28d9', bleu: '#1d4ed8', cyan: '#0e7490', vert: '#15803d', olive: '#4d7c0f', gris: '#475569', brun: '#78350f' };
const COLOR_KEYS = Object.keys(COLORS);
const METHOD_LABEL = { cb: 'Carte bancaire', cash: 'Espèces', tab: 'Ardoise' };

let toastTimer = null;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3200);
}

/* ========== stockage (IndexedDB) ========== */
const STORES = ['products', 'tickets', 'volunteers', 'events', 'sales', 'meta'];
const S = {};
STORES.forEach(s => (S[s] = {}));
let db = null;
let dbOk = true;

function openDB() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open('caisse-manifestation', 1);
    r.onupgradeneeded = () => STORES.forEach(s => r.result.createObjectStore(s, { keyPath: 'id' }));
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
function loadAll() {
  return Promise.all(STORES.map(store => new Promise((resolve, reject) => {
    const req = db.transaction(store).objectStore(store).getAll();
    req.onsuccess = () => { req.result.forEach(o => (S[store][o.id] = o)); resolve(); };
    req.onerror = () => reject(req.error);
  })));
}
function dbFail(e) {
  console.error(e);
  if (dbOk) { dbOk = false; toast('Erreur d’enregistrement : faites une sauvegarde dès que possible.'); render(); }
}
/* putLocal/delLocal : écriture locale seule (utilisée aussi pour les données reçues des autres tablettes).
   save/del : écriture locale puis envoi vers les autres tablettes si la synchronisation est active. */
function putLocal(store, obj) {
  S[store][obj.id] = obj;
  if (db) {
    try {
      const tx = db.transaction(store, 'readwrite');
      tx.objectStore(store).put(obj);
      tx.onerror = () => dbFail(tx.error);
    } catch (e) { dbFail(e); }
  }
  return obj;
}
function delLocal(store, id) {
  delete S[store][id];
  if (db) {
    try {
      const tx = db.transaction(store, 'readwrite');
      tx.objectStore(store).delete(id);
      tx.onerror = () => dbFail(tx.error);
    } catch (e) { dbFail(e); }
  }
}
function save(store, obj) {
  putLocal(store, obj);
  if (store !== 'meta') Sync.onSave(store, obj);
  return obj;
}
function del(store, id) {
  delLocal(store, id);
  if (store !== 'meta') Sync.onDelete(store, id);
}
function clearAllStores() {
  return Promise.all(STORES.map(store => new Promise((resolve, reject) => {
    S[store] = {};
    if (!db) return resolve();
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  })));
}
const getMeta = () => S.meta.app || { id: 'app' };
const setMeta = patch => save('meta', Object.assign(getMeta(), patch));
/* Les réassorts sont stockés en dictionnaire (et non en liste) pour que deux tablettes puissent en ajouter en même temps. */
function migrate() {
  Object.values(S.events).forEach(ev => {
    let ch = false;
    if (Array.isArray(ev.restocks)) { const m = {}; ev.restocks.forEach(r => { m[r.id] = r; }); ev.restocks = m; ch = true; }
    ['products', 'volunteers', 'tabs', 'restocks'].forEach(k => { if (!ev[k] || typeof ev[k] !== 'object') { ev[k] = {}; ch = true; } });
    if (ch) putLocal('events', ev);
  });
}

/* ========== calculs ========== */
function salesOf(ev, withVoided = false) {
  return list('sales').filter(s => s.eventId === ev.id && (withVoided || !s.voided)).sort((a, b) => (a.at < b.at ? -1 : 1));
}
function stockOf(ev) {
  const out = {};
  Object.keys(ev.products).forEach(pid => { out[pid] = { start: ev.products[pid].stock, restock: 0, sold: 0, left: null }; });
  Object.values(ev.restocks || {}).forEach(r => { if (out[r.productId]) out[r.productId].restock += r.qty; });
  /* Produit non suivi au départ : le suivi commence au premier réassort (seules les ventes suivantes sont décomptées). */
  const since = {};
  Object.values(ev.restocks || {}).forEach(r => { if (out[r.productId] && out[r.productId].start == null && (!since[r.productId] || r.at < since[r.productId])) since[r.productId] = r.at; });
  salesOf(ev).forEach(s => s.lines.forEach(l => {
    const o = out[l.productId]; if (!o) return;
    o.sold += l.qty;
    if (o.start != null || (since[l.productId] && s.at >= since[l.productId])) o.soldTracked = (o.soldTracked || 0) + l.qty;
  }));
  Object.entries(out).forEach(([pid, o]) => {
    o.tracked = o.start != null || !!since[pid];
    o.left = o.start != null ? o.start + o.restock - o.sold : since[pid] ? o.restock - (o.soldTracked || 0) : null;
  });
  return out;
}
function tabOf(ev, vid) {
  const v = (ev.volunteers || {})[vid];
  const credit = v ? v.credit || 0 : 0;
  const sales = salesOf(ev).filter(s => s.method === 'tab' && s.volunteerId === vid);
  const consumed = sum(sales, s => s.total);
  return {
    sales, consumed, credit,
    used: Math.min(consumed, credit),
    due: Math.max(0, consumed - credit),
    left: Math.max(0, credit - consumed),
    settled: (ev.tabs || {})[vid] || null,
  };
}
function totalsOf(ev) {
  const sales = salesOf(ev);
  const t = { count: sales.length, revenue: 0, cb: 0, cash: 0, tabConsumed: 0, credit: 0, tabCb: 0, tabCash: 0, unpaid: 0, laterPaid: 0, openDue: 0 };
  sales.forEach(s => {
    t.revenue += s.total;
    if (s.method === 'cb') t.cb += s.total;
    else if (s.method === 'cash') t.cash += s.total;
    else t.tabConsumed += s.total;
  });
  Object.keys(ev.volunteers || {}).forEach(vid => {
    const tb = tabOf(ev, vid);
    if (!tb.consumed) return;
    t.credit += tb.used;
    const st = tb.settled;
    if (!st) t.openDue += tb.due;
    else if (st.status === 'paid') { if (st.method === 'cb') t.tabCb += st.amount; else if (st.method === 'cash') t.tabCash += st.amount; }
    else if (st.status === 'unpaid') { if (st.settledLater) t.laterPaid += st.amount; else t.unpaid += st.amount; }
  });
  t.cbTotal = t.cb + t.tabCb;
  t.cashTotal = t.cash + t.tabCash;
  t.collected = t.cbTotal + t.cashTotal;
  t.cashExpected = (ev.floatCents || 0) + t.cashTotal;
  t.avg = t.count ? Math.round(t.revenue / t.count) : 0;
  return t;
}
function productAgg(ev) {
  const m = {};
  salesOf(ev).forEach(s => s.lines.forEach(l => {
    const a = m[l.productId] || (m[l.productId] = { id: l.productId, name: l.name, qty: 0, revenue: 0, cb: 0, cash: 0, tab: 0 });
    a.name = l.name; a.qty += l.qty; a.revenue += l.qty * l.price; a[s.method] += l.qty;
  }));
  return m;
}
function groupTickets(lines) {
  const m = new Map();
  lines.forEach(l => m.set(l.ticketName, (m.get(l.ticketName) || 0) + l.qty));
  return [...m.entries()];
}
function pendingTabs(ev) {
  return Object.keys(ev.volunteers || {}).filter(vid => { const tb = tabOf(ev, vid); return tb.consumed > 0 && !tb.settled; });
}

/* ========== opérations sur les données ========== */
function applyTicket(p, choice) {
  const old = S.tickets[p.ticketId];
  if (choice === 'own') {
    if (old && !old.shared) { old.name = p.name; save('tickets', old); }
    else { const t = save('tickets', { id: uid(), name: p.name, shared: false }); p.ticketId = t.id; }
  } else {
    if (old && !old.shared && old.id !== choice) del('tickets', old.id);
    p.ticketId = choice;
  }
}
const COLOR_BY_CAT = () => {
  const m = {};
  list('products').sort(sortProducts).forEach(p => { m[p.category] = p.color; });
  return m;
};
function createProduct({ name, category, price, ticket }) {
  const p = { id: uid(), createdAt: Date.now(), active: true, name, category, price };
  const byCat = COLOR_BY_CAT();
  p.color = byCat[category] || COLOR_KEYS[Object.keys(byCat).length % COLOR_KEYS.length];
  applyTicket(p, ticket);
  return save('products', p);
}
function createEvent({ name, date, from }) {
  const ev = { id: uid(), name, date, dateEnd: '', place: '', floatCents: 0, defaultCredit: 0, status: 'prep', products: {}, volunteers: {}, restocks: {}, tabs: {}, createdAt: Date.now() };
  const src = from && S.events[from];
  if (src) {
    ev.place = src.place; ev.floatCents = src.floatCents; ev.defaultCredit = src.defaultCredit;
    Object.keys(src.products).forEach(pid => {
      if (S.products[pid] && S.products[pid].active) ev.products[pid] = { price: src.products[pid].price, stock: src.products[pid].stock };
    });
    Object.keys(src.volunteers).forEach(vid => {
      if (S.volunteers[vid] && S.volunteers[vid].active) ev.volunteers[vid] = { credit: src.volunteers[vid].credit };
    });
  }
  return save('events', ev);
}
function recordSale(ev, cart, method, extra) {
  const lines = cart.map(c => {
    const p = S.products[c.pid];
    const tk = S.tickets[p.ticketId];
    return { productId: p.id, name: p.name, ticketId: p.ticketId, ticketName: tk ? tk.name : p.name, qty: c.qty, price: ev.products[c.pid].price };
  });
  const total = sum(lines, l => l.qty * l.price);
  return save('sales', Object.assign({ id: uid(), eventId: ev.id, at: new Date().toISOString(), lines, total, method }, Sync.tabletName() ? { tablet: Sync.tabletName() } : {}, extra));
}

/* ========== état de l'interface ========== */
const ui = { cart: [], filter: 'all', pay: null, modal: null, settle: null, cmp: { a: '', b: '' }, lastTicket: 'own' };
const CART_KEY = 'caisse.cart.v1';
function persistCart(evId) {
  try { localStorage.setItem(CART_KEY, JSON.stringify({ eventId: evId, cart: ui.cart })); } catch (e) { /* stockage indisponible */ }
}
function restoreCart() {
  try {
    const d = JSON.parse(localStorage.getItem(CART_KEY) || 'null');
    if (d && S.events[d.eventId] && S.events[d.eventId].status === 'open') {
      ui.cart = d.cart.filter(c => S.products[c.pid] && S.events[d.eventId].products[c.pid]);
      ui.cartEvent = d.eventId;
    }
  } catch (e) { /* ignoré */ }
}

/* ========== vues ========== */
const STATUS = { prep: 'En préparation', open: 'En cours', closed: 'Terminée' };
const statusBadge = ev => `<span class="badge ${ev.status}">${STATUS[ev.status]}</span>`;

function syncPill() {
  if (!Sync.linked()) return '';
  const p = Sync.pillInfo();
  return `<a class="syncpill ${p.cls}" href="#/sync">${esc(p.text)}</a>`;
}
function syncTileText() {
  if (!Sync.enabled()) return 'Non configuré';
  return Sync.linked() ? (Sync.tabletName() ? 'Active · ' + esc(Sync.tabletName()) : 'Active') : 'Pas encore activée';
}
function eventNav(ev, active) {
  const L = (k, label) => `<a href="#/event/${ev.id}/${k}" class="${active === k ? 'on' : ''}">${label}</a>`;
  if (ev.status === 'prep') return L('prep', 'Préparation');
  if (ev.status === 'open') return L('cash', 'Caisse') + L('monitor', 'Suivi') + L('tabs', 'Ardoises') + L('bilan', 'Bilan') + L('prep', 'Préparation');
  return L('bilan', 'Bilan') + L('monitor', 'Ventes') + L('tabs', 'Ardoises');
}
function topbar(ev, active) {
  return `<header class="top"><a class="brand" href="#/">Accueil</a>
    ${ev ? `<div class="evtitle"><strong>${esc(ev.name)}</strong> ${statusBadge(ev)}</div><nav class="tabs">${eventNav(ev, active)}</nav>` : ''}${syncPill()}</header>`;
}
const storageBanner = () => (dbOk ? '' : '<div class="banner bad"><div class="grow"><b>Le stockage du navigateur ne répond pas.</b> Les données risquent d’être perdues. Faites une sauvegarde dès que possible.</div><a class="btn" href="#/backup">Sauvegarder</a></div>');
const emptyMsg = t => `<p class="muted">${t}</p>`;

function backupWarning() {
  const m = getMeta();
  if (!list('events').length && !list('products').length) return '';
  const days = m.lastBackupAt ? (Date.now() - new Date(m.lastBackupAt)) / 864e5 : Infinity;
  if (days <= 30) return '';
  return `<div class="banner warn"><div class="grow"><b>Pensez à sauvegarder.</b> ${m.lastBackupAt ? `Dernière sauvegarde il y a ${Math.floor(days)} jours.` : 'Aucune sauvegarde pour l’instant.'}</div><a class="btn" href="#/backup">Sauvegarder</a></div>`;
}

/* ---------- accueil ---------- */
function evCard(ev) {
  const t = totalsOf(ev);
  const np = Object.keys(ev.products).length, nv = Object.keys(ev.volunteers).length;
  let btns;
  if (ev.status === 'open') btns = `<a class="btn primary" href="#/event/${ev.id}/cash">Ouvrir la caisse</a><a class="btn" href="#/event/${ev.id}/monitor">Suivi</a>`;
  else if (ev.status === 'prep') btns = `<a class="btn primary" href="#/event/${ev.id}/prep">Préparer</a><button class="btn" data-act="ev-dup" data-id="${ev.id}">Dupliquer</button><button class="btn ghost" data-act="ev-delete" data-id="${ev.id}">Supprimer</button>`;
  else btns = `<a class="btn primary" href="#/event/${ev.id}/bilan">Bilan</a><button class="btn" data-act="ev-dup" data-id="${ev.id}">Dupliquer</button>`;
  const info = ev.status === 'prep'
    ? `${np} produit${np > 1 ? 's' : ''} · ${nv} bénévole${nv > 1 ? 's' : ''}`
    : `${t.count} vente${t.count > 1 ? 's' : ''} · ${fmt(t.revenue)}`;
  return `<div class="card"><div class="row sb"><b>${esc(ev.name)}</b>${statusBadge(ev)}</div>
    <div class="muted">${esc(fmtDate(ev.date))}${ev.place ? ' · ' + esc(ev.place) : ''}</div><div>${info}</div>
    <div class="row" style="margin-top:.3rem">${btns}</div></div>`;
}
function viewHome() {
  const evs = list('events');
  const open = evs.filter(e => e.status === 'open');
  const prep = evs.filter(e => e.status === 'prep').sort((a, b) => (a.date < b.date ? -1 : 1));
  const closed = evs.filter(e => e.status === 'closed').sort((a, b) => (a.date < b.date ? 1 : -1));
  const m = getMeta();
  let h = topbar(null) + `<main id="main" class="page" data-keep="main"><h1>Caisse de manifestation</h1>${storageBanner()}${backupWarning()}`;
  if (!evs.length && !list('products').length) {
    h += `<div class="card"><h2>Bienvenue</h2><p>Pour commencer : ajoutez vos produits au catalogue, puis créez une manifestation et indiquez les stocks. Vous pouvez aussi essayer l’appli avec des données d’exemple.</p>
      <div class="row"><a class="btn primary" href="#/catalog">Ajouter mes produits</a><button class="btn" data-act="sample">Charger un jeu d’exemple</button></div></div>`;
  }
  if (open.length) h += `<div class="sec-title"><h2>En cours</h2></div><div class="cards">${open.map(evCard).join('')}</div>`;
  h += `<div class="sec-title"><h2>À venir</h2><button class="btn primary" data-act="ev-new">Nouvelle manifestation</button></div>`;
  h += prep.length ? `<div class="cards">${prep.map(evCard).join('')}</div>` : emptyMsg('Aucune manifestation en préparation.');
  if (closed.length) h += `<div class="sec-title"><h2>Terminées</h2><a class="btn" href="#/history">Tout l’historique</a></div><div class="cards">${closed.slice(0, 3).map(evCard).join('')}</div>`;
  h += `<div class="shortcuts">
    <a class="shortcut" href="#/catalog"><b>Catalogue</b><span>${list('products').filter(p => p.active).length} produits</span></a>
    <a class="shortcut" href="#/volunteers"><b>Bénévoles</b><span>${list('volunteers').filter(v => v.active).length} personnes</span></a>
    <a class="shortcut" href="#/history"><b>Historique</b><span>${closed.length} manifestation${closed.length > 1 ? 's' : ''} terminée${closed.length > 1 ? 's' : ''}</span></a>
    <a class="shortcut" href="#/backup"><b>Sauvegarde</b><span>${m.lastBackupAt ? 'Dernière : ' + esc(fmtDateTime(m.lastBackupAt)) : 'Jamais sauvegardé'}</span></a>
    <a class="shortcut" href="#/sync"><b>Plusieurs tablettes</b><span>${syncTileText()}</span></a></div>
    <p class="muted" style="margin-top:1.5rem">Version ${VERSION} · les données sont enregistrées sur cette tablette.</p></main>`;
  return h;
}

/* ---------- catalogue ---------- */
function productRow(p) {
  const tk = S.tickets[p.ticketId];
  return `<tr class="${p.active ? '' : 'off'}"><td><span class="dot" style="--c:${COLORS[p.color] || '#555'}"></span><b>${esc(p.name)}</b></td>
    <td class="r tnum">${fmt(p.price)}</td><td>${tk ? (tk.shared ? `<span class="badge">${esc(tk.name)}</span>` : 'Ticket propre') : ''}</td>
    <td class="r"><button class="btn small" data-act="p-edit" data-id="${p.id}">Modifier</button>
    <button class="btn small ghost" data-act="${p.active ? 'p-archive' : 'p-restore'}" data-id="${p.id}">${p.active ? 'Archiver' : 'Restaurer'}</button></td></tr>`;
}
function viewCatalog() {
  const prods = list('products').sort(sortProducts);
  const act = prods.filter(p => p.active), arch = prods.filter(p => !p.active);
  const shared = list('tickets').filter(t => t.shared).sort(byName);
  const cats = [...new Set(act.map(p => p.category))];
  const allCats = [...new Set(['Boissons', 'Nourriture', 'Desserts', ...prods.map(p => p.category)])];
  let h = topbar(null) + `<main id="main" class="page" data-keep="main"><h1>Catalogue</h1>${storageBanner()}
    <form class="card quick-add" data-form="quickprod">
      <label>Nom<input name="name" required autocomplete="off" data-autofocus placeholder="Bière pression 25 cl"></label>
      <label>Catégorie<input name="category" list="cats" value="${esc(ui.lastCategory || '')}" placeholder="Boissons" autocomplete="off"></label>
      ${catPicker(allCats, ui.lastCategory)}
      <label>Prix (€)<input name="price" inputmode="decimal" required placeholder="2,50" autocomplete="off"></label>
      <label>Ticket<select name="ticket"><option value="own">Ticket propre</option>${shared.map(t => `<option value="${t.id}" ${ui.lastTicket === t.id ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select></label>
      <button class="btn primary">Ajouter</button></form>
    <datalist id="cats">${allCats.map(c => `<option value="${esc(c)}">`).join('')}</datalist>`;
  if (!act.length) h += emptyMsg('Aucun produit pour l’instant. Remplissez la ligne ci-dessus : après « Ajouter », vous pouvez enchaîner avec le produit suivant.');
  else {
    h += `<div class="card tablewrap"><table><thead><tr><th>Produit</th><th class="r">Prix</th><th>Ticket remis</th><th></th></tr></thead><tbody>`;
    cats.forEach(c => {
      h += `<tr class="group"><td colspan="4">${esc(c)}</td></tr>` + act.filter(p => p.category === c).map(productRow).join('');
    });
    h += `</tbody></table></div>`;
  }
  h += `<div class="sec-title"><h2>Tickets partagés</h2><button class="btn" data-act="t-add">Nouveau ticket partagé</button></div>
    <div class="card">${shared.length ? shared.map(t => {
      const used = list('products').filter(p => p.ticketId === t.id);
      return `<div class="row sb" style="padding:.3rem 0"><div><b>${esc(t.name)}</b> <span class="muted">· ${used.length ? used.map(p => esc(p.name)).join(', ') : 'aucun produit'}</span></div>
        <div class="row"><button class="btn small" data-act="t-rename" data-id="${t.id}">Renommer</button>${used.length ? '' : `<button class="btn small ghost" data-act="t-del" data-id="${t.id}">Supprimer</button>`}</div></div>`;
    }).join('') : emptyMsg('Par défaut chaque produit a son propre ticket. Créez un ticket partagé (par exemple « Boisson ») quand un seul ticket sert pour plusieurs produits, puis choisissez-le dans la liste « Ticket » du produit.')}</div>`;
  if (arch.length) h += `<div class="sec-title"><h2>Archivés</h2></div><div class="card tablewrap"><table><tbody>${arch.map(productRow).join('')}</tbody></table></div>`;
  return h + '</main>';
}

/* ---------- bénévoles ---------- */
function viewVolunteers() {
  const vs = list('volunteers').sort(byName);
  const act = vs.filter(v => v.active), arch = vs.filter(v => !v.active);
  const row = v => `<div class="row sb" style="padding:.35rem 0;border-bottom:1px solid var(--line)"><b class="${v.active ? '' : 'muted'}">${esc(v.name)}</b>
    <div class="row"><button class="btn small" data-act="v-rename" data-id="${v.id}">Renommer</button>
    <button class="btn small ghost" data-act="${v.active ? 'v-archive' : 'v-restore'}" data-id="${v.id}">${v.active ? 'Archiver' : 'Restaurer'}</button></div></div>`;
  return topbar(null) + `<main id="main" class="page" data-keep="main"><h1>Bénévoles</h1>${storageBanner()}
    <form class="card row" data-form="vol-add"><label class="grow">Nom ou prénom<input name="name" required autocomplete="off" data-autofocus placeholder="Camille D."></label>
      <button class="btn primary" style="align-self:flex-end">Ajouter</button></form>
    <div class="card">${act.length ? act.map(row).join('') : emptyMsg('Aucun bénévole. Ajoutez les noms à la suite, ils seront réutilisables d’une manifestation à l’autre.')}</div>
    ${arch.length ? `<div class="sec-title"><h2>Archivés</h2></div><div class="card">${arch.map(row).join('')}</div>` : ''}</main>`;
}

/* ---------- préparation d'une manifestation ---------- */
function viewPrep(ev) {
  const prods = list('products').filter(p => p.active || ev.products[p.id]).sort(sortProducts);
  const vols = list('volunteers').filter(v => v.active || ev.volunteers[v.id]).sort(byName);
  const nProd = Object.keys(ev.products).length;
  let h = topbar(ev, 'prep') + `<main id="main" class="page" data-keep="main"><h1>${ev.status === 'prep' ? 'Préparer la manifestation' : 'Modifier la préparation'}</h1>${storageBanner()}
    <div class="card"><div class="formgrid">
      <label>Nom<input data-chg="evf" data-f="name" value="${esc(ev.name)}"></label>
      <label>Date<input type="date" data-chg="evf" data-f="date" value="${esc(ev.date)}"></label>
      <label>Jusqu’au (facultatif)<input type="date" data-chg="evf" data-f="dateEnd" value="${esc(ev.dateEnd)}"></label>
      <label>Lieu<input data-chg="evf" data-f="place" value="${esc(ev.place)}"></label>
      <label>Fond de caisse (€)<input inputmode="decimal" data-chg="evf" data-f="floatCents" value="${toInput(ev.floatCents)}"></label></div></div>
    <div class="sec-title"><h2>Produits vendus et stock de départ</h2><div class="row"><button class="btn small" data-act="prod-all" data-v="1">Tout cocher</button><button class="btn small" data-act="prod-all" data-v="0">Tout décocher</button></div></div>`;
  if (!prods.length) h += `<div class="card">${emptyMsg('Le catalogue est vide.')}<a class="btn primary" href="#/catalog">Ajouter des produits</a></div>`;
  else {
    h += `<div class="card tablewrap"><table><thead><tr><th></th><th>Produit</th><th class="r">Prix (€)</th><th class="r">Stock de départ</th></tr></thead><tbody>`;
    prods.forEach(p => {
      const cfg = ev.products[p.id];
      const dis = cfg ? '' : 'disabled';
      h += `<tr class="${cfg ? '' : 'off'}"><td><input type="checkbox" data-chg="evinc" data-id="${p.id}" ${cfg ? 'checked' : ''} aria-label="Vendre ${esc(p.name)}"></td>
        <td><span class="dot" style="--c:${COLORS[p.color] || '#555'}"></span><b>${esc(p.name)}</b> <span class="muted">${esc(p.category)}</span></td>
        <td class="r"><input class="num" inputmode="decimal" data-chg="evprice" data-id="${p.id}" value="${cfg ? toInput(cfg.price) : toInput(p.price)}" ${dis}></td>
        <td class="r"><input class="num" inputmode="numeric" data-nav="stock" data-chg="evstock" data-id="${p.id}" value="${cfg && cfg.stock != null ? cfg.stock : ''}" placeholder="non suivi" ${dis}></td></tr>`;
    });
    h += `</tbody></table></div><p class="muted">Laissez le stock vide pour ne pas le suivre. La touche Entrée passe au produit suivant. Le prix saisi ici ne vaut que pour cette manifestation.</p>`;
  }
  h += `<div class="sec-title"><h2>Bénévoles et crédit offert</h2><div class="row">
      <label class="row" style="gap:.5rem">Crédit par défaut (€)<input class="num" inputmode="decimal" data-chg="evf" data-f="defaultCredit" value="${toInput(ev.defaultCredit)}"></label>
      <button class="btn small" data-act="credit-apply">Appliquer aux présents</button>
      <button class="btn small" data-act="vol-all">Tout sélectionner</button><button class="btn small" data-act="vol-none">Tout retirer</button></div></div>
    <div class="card">`;
  h += vols.length ? `<div class="tablewrap"><table><tbody>${vols.map(v => {
    const cfg = ev.volunteers[v.id];
    return `<tr class="${cfg ? '' : 'off'}"><td style="width:48px"><input type="checkbox" data-chg="evvol" data-id="${v.id}" ${cfg ? 'checked' : ''} aria-label="Présent : ${esc(v.name)}"></td><td><b>${esc(v.name)}</b></td>
      <td class="r"><input class="num" inputmode="decimal" data-nav="credit" data-chg="evcredit" data-id="${v.id}" value="${cfg ? toInput(cfg.credit) : ''}" ${cfg ? '' : 'disabled'} aria-label="Crédit de ${esc(v.name)}"></td></tr>`;
  }).join('')}</tbody></table></div>` : emptyMsg('Aucun bénévole dans la liste.');
  h += `<form class="row" data-form="prep-vol-add" style="margin-top:.8rem"><label class="grow">Ajouter un bénévole<input name="name" autocomplete="off" placeholder="Nom ou prénom"></label><button class="btn" style="align-self:flex-end">Ajouter</button></form></div>`;
  if (ev.status === 'prep') {
    h += `<div class="row" style="justify-content:flex-end"><button class="btn primary big" data-act="ev-open" ${nProd ? '' : 'disabled'}>Ouvrir la caisse</button></div>
      <p class="muted r">${nProd ? 'Vous pouvez encore modifier les prix et les stocks après l’ouverture.' : 'Cochez au moins un produit pour ouvrir la caisse.'}</p>`;
  }
  return h + '</main>';
}

/* ---------- caisse ---------- */
function stockBadge(left, inCart) {
  if (left == null) return '';
  const r = left - inCart;
  if (r <= 0) return '<span class="sb out">Épuisé</span>';
  if (r <= 5) return `<span class="sb low">Reste ${r}</span>`;
  return `<span class="sb">${r}</span>`;
}
const cartTotal = ev => sum(ui.cart, c => c.qty * ev.products[c.pid].price);
function viewCash(ev) {
  const top = topbar(ev, 'cash');
  if (ev.status !== 'open') {
    const msg = ev.status === 'prep'
      ? `<h2>La manifestation n’est pas encore ouverte</h2><p>Terminez la préparation puis ouvrez la caisse.</p><a class="btn primary" href="#/event/${ev.id}/prep">Aller à la préparation</a>`
      : `<h2>Cette manifestation est terminée</h2><a class="btn primary" href="#/event/${ev.id}/bilan">Voir le bilan</a>`;
    return top + `<main id="main" class="page"><div class="card">${msg}</div></main>`;
  }
  const stock = stockOf(ev);
  const prods = Object.keys(ev.products).map(id => S.products[id]).filter(Boolean).sort(sortProducts);
  const cats = [...new Set(prods.map(p => p.category))];
  if (ui.filter !== 'all' && !cats.includes(ui.filter)) ui.filter = 'all';
  const qtyIn = id => (ui.cart.find(c => c.pid === id) || { qty: 0 }).qty;
  const btn = p => {
    const left = stock[p.id].left, inCart = qtyIn(p.id);
    const out = left != null && left - inCart <= 0;
    return `<button class="prod" style="--c:${COLORS[p.color] || '#475569'}" data-act="add" data-id="${p.id}" ${out ? 'disabled' : ''}>
      <span class="pn">${esc(p.name)}</span><span class="pp">${fmt(ev.products[p.id].price)}</span>${stockBadge(left, inCart)}${inCart ? `<span class="pq">${inCart}</span>` : ''}</button>`;
  };
  let grid = '';
  if (ui.filter === 'all') cats.forEach(c => { grid += `${cats.length > 1 ? `<h3 class="cat-title">${esc(c)}</h3>` : ''}<div class="grid">${prods.filter(p => p.category === c).map(btn).join('')}</div>`; });
  else grid = `<div class="grid">${prods.filter(p => p.category === ui.filter).map(btn).join('')}</div>`;
  const total = cartTotal(ev);
  const lines = ui.cart.map(c => {
    const p = S.products[c.pid], price = ev.products[c.pid].price, left = stock[c.pid].left;
    return `<div class="cl"><div class="cn">${esc(p.name)}<small>${fmt(price)}</small></div>
      <div class="cq"><button class="qbtn" data-act="dec" data-id="${c.pid}" aria-label="Retirer un ${esc(p.name)}">−</button><b>${c.qty}</b>
      <button class="qbtn" data-act="inc" data-id="${c.pid}" ${left != null && c.qty >= left ? 'disabled' : ''} aria-label="Ajouter un ${esc(p.name)}">+</button></div>
      <div class="ct">${fmt(c.qty * price)}</div></div>`;
  }).join('');
  return top + `<main id="main" class="cash-main">
    <section class="cash-products" data-keep="prods">
      ${cats.length > 1 ? `<div class="chips"><button class="chip ${ui.filter === 'all' ? 'on' : ''}" data-act="filter" data-v="all">Tout</button>${cats.map(c => `<button class="chip ${ui.filter === c ? 'on' : ''}" data-act="filter" data-v="${esc(c)}">${esc(c)}</button>`).join('')}</div>` : ''}
      ${grid}</section>
    <aside class="cart"><h2>Commande</h2>
      <div class="cart-lines" data-keep="cart">${lines || '<div class="cart-empty">Touchez les produits pour les ajouter.</div>'}</div>
      <div class="cart-foot"><div class="total"><span>Total</span><strong>${fmt(total)}</strong></div>
        <div class="cart-btns"><button class="btn" data-act="cart-clear" ${ui.cart.length ? '' : 'disabled'}>Vider</button>
        <button class="btn primary big" data-act="pay-start" ${ui.cart.length ? '' : 'disabled'}>Encaisser</button></div></div></aside></main>`;
}

/* ---------- fenêtre de paiement ---------- */
function keypad() {
  return `<div class="keypad">${['7', '8', '9', '4', '5', '6', '1', '2', '3', ',', '0', 'back'].map(k => `<button class="key" data-act="key" data-k="${k}" aria-label="${k === 'back' ? 'Effacer' : k}">${k === 'back' ? '⌫' : k}</button>`).join('')}</div>`;
}
function cashWidget(due, recv) {
  const r = recv === '' ? null : parseEuro(recv);
  const diff = r == null ? null : r - due;
  return `<div class="cashw"><div>
    <div class="cw-row"><span>À payer</span><strong>${fmt(due)}</strong></div>
    <div class="cw-row"><span>Reçu</span><strong>${recv === '' ? '—' : esc(recv) + ' €'}</strong></div>
    <div class="cw-row change ${diff != null && diff < 0 ? 'short' : ''}"><span>${diff != null && diff < 0 ? 'Il manque' : 'À rendre'}</span><strong>${diff == null ? '—' : fmt(Math.abs(diff))}</strong></div>
    <div class="quick"><button class="btn" data-act="exact">Compte juste</button>${[5, 10, 20, 50].map(b => `<button class="btn" data-act="bill" data-v="${b}">${b} €</button>`).join('')}<button class="btn ghost" data-act="key" data-k="clear">Effacer</button></div>
  </div>${keypad()}</div>`;
}
function payHTML(ev) {
  const P = ui.pay;
  let inner = '';
  if (P.step === 'method') {
    inner = `<h2>Encaisser</h2><div class="bigtotal">${fmt(P.total)}</div>
      <div class="pay-methods"><button class="method cb" data-act="pay-step" data-v="cb">Carte bancaire</button><button class="method cash" data-act="pay-step" data-v="cash">Espèces</button><button class="method tab" data-act="pay-step" data-v="tab">Ardoise bénévole</button></div>
      <div class="modal-actions"><button class="btn" data-act="pay-cancel">Retour à la commande</button></div>`;
  } else if (P.step === 'cb') {
    inner = `<h2>Carte bancaire</h2><div class="bigtotal">${fmt(P.total)}</div><p class="muted" style="text-align:center">Validez quand le terminal a accepté le paiement.</p>
      <div class="modal-actions"><button class="btn" data-act="pay-step" data-v="method">Retour</button><button class="btn primary big" data-act="pay-cb-ok">Paiement accepté</button></div>`;
  } else if (P.step === 'cash') {
    const r = P.recv === '' ? null : parseEuro(P.recv);
    inner = `<h2>Espèces</h2>${cashWidget(P.total, P.recv)}
      <div class="modal-actions"><button class="btn" data-act="pay-step" data-v="method">Retour</button><button class="btn primary big" data-act="pay-cash-ok" ${r != null && r >= P.total ? '' : 'disabled'}>Valider</button></div>`;
  } else if (P.step === 'tab') {
    const vs = Object.keys(ev.volunteers).map(id => S.volunteers[id]).filter(Boolean).sort(byName);
    inner = `<h2>Ardoise bénévole</h2><div class="bigtotal" style="font-size:2rem">${fmt(P.total)}</div>
      <input class="field" id="vsearch" placeholder="Rechercher un nom" autocomplete="off">
      <div class="vol-list">${vs.map(v => {
        const tb = tabOf(ev, v.id);
        return `<button class="vol-btn" data-act="pay-vol" data-id="${v.id}" data-name="${esc(v.name.toLowerCase())}" ${tb.settled ? 'disabled' : ''}><b>${esc(v.name)}</b><small>${tb.settled ? 'Ardoise réglée' : `Crédit restant ${fmt(tb.left)}`}</small></button>`;
      }).join('') || '<span class="muted">Aucun bénévole sur cette manifestation.</span>'}</div>
      <div class="modal-actions"><button class="btn" data-act="pay-step" data-v="method">Retour</button><button class="btn" data-act="pay-vol-new">Nouveau bénévole</button></div>`;
  } else if (P.step === 'tabconfirm') {
    const v = S.volunteers[P.volunteerId], tb = tabOf(ev, v.id);
    const after = Math.max(0, tb.consumed + P.total - tb.credit);
    inner = `<h2>Ardoise de ${esc(v.name)}</h2>
      <div class="summary"><div><span>Déjà consommé</span><b>${fmt(tb.consumed)}</b></div><div><span>Cette commande</span><b>${fmt(P.total)}</b></div>
      <div><span>Crédit offert</span><b>${fmt(tb.credit)}</b></div><div><span>Reste à payer à la fin</span><b>${fmt(after)}</b></div></div>
      <div class="modal-actions"><button class="btn" data-act="pay-step" data-v="tab">Retour</button><button class="btn primary big" data-act="pay-tab-ok">Mettre sur l’ardoise</button></div>`;
  } else if (P.step === 'done') {
    const sale = P.sale, tk = groupTickets(sale.lines);
    inner = `<h2>Remettre les tickets</h2><div class="ticket-list">${tk.map(([n, q]) => `<div class="tk"><b>${q}</b><span>×</span><span>${esc(n)}</span></div>`).join('')}</div>
      ${sale.method === 'cash' ? (sale.change > 0 ? `<div class="change-big">Rendre<strong>${fmt(sale.change)}</strong></div>` : '<div class="change-big">Compte juste</div>') : ''}
      ${sale.method === 'tab' ? `<p class="muted" style="text-align:center">Sur l’ardoise de ${esc((S.volunteers[sale.volunteerId] || {}).name || '')} · ${fmt(sale.total)}</p>` : ''}
      <div class="done-actions"><button class="btn ghost" data-act="sale-undo">Annuler cette vente</button><button class="btn primary big" data-act="pay-next">Commande suivante</button></div>`;
  }
  return `<div class="overlay"><div class="sheet" role="dialog" aria-modal="true">${inner}</div></div>`;
}

/* ---------- suivi ---------- */
function saleSummary(s) { return s.lines.map(l => `${l.qty} × ${esc(l.name)}`).join(', '); }
function viewMonitor(ev) {
  const t = totalsOf(ev), stock = stockOf(ev);
  const prods = Object.keys(ev.products).map(id => S.products[id]).filter(Boolean).sort(sortProducts);
  const sales = salesOf(ev, true).reverse();
  const canEdit = ev.status === 'open';
  let h = topbar(ev, 'monitor') + `<main id="main" class="page" data-keep="main"><h1>${canEdit ? 'Suivi en direct' : 'Ventes'}</h1>
    <div class="tiles"><div class="tile hl"><div class="k">Chiffre d’affaires</div><div class="v">${fmt(t.revenue)}</div><div class="s">${t.count} vente${t.count > 1 ? 's' : ''}</div></div>
    <div class="tile"><div class="k">Carte bancaire</div><div class="v">${fmt(t.cbTotal)}</div></div>
    <div class="tile"><div class="k">Espèces</div><div class="v">${fmt(t.cashTotal)}</div><div class="s">dont fond de caisse ${fmt(ev.floatCents)} : ${fmt(t.cashExpected)} en caisse</div></div>
    <div class="tile"><div class="k">Ardoises</div><div class="v">${fmt(t.tabConsumed)}</div><div class="s">dont crédit offert ${fmt(t.credit)}</div></div></div>
    <div class="sec-title"><h2>Stocks</h2></div>
    <div class="card tablewrap"><table><thead><tr><th>Produit</th><th class="r">Départ</th><th class="r">Réassort</th><th class="r">Vendu</th><th class="r">Reste</th><th></th></tr></thead><tbody>
    ${prods.map(p => {
      const s = stock[p.id];
      return `<tr><td><span class="dot" style="--c:${COLORS[p.color] || '#555'}"></span><b>${esc(p.name)}</b></td><td class="r tnum">${s.start == null ? '—' : s.start}</td><td class="r tnum">${s.restock ? '+' + s.restock : '—'}</td>
        <td class="r tnum">${s.sold}</td><td class="r tnum"><b class="${s.left != null && s.left <= 5 ? 'neg' : ''}">${s.left == null ? '—' : s.left}</b></td>
        <td class="r">${canEdit ? `<button class="btn small" data-act="restock" data-id="${p.id}">Réassort</button>` : ''}</td></tr>`;
    }).join('')}</tbody></table></div>
    <div class="sec-title"><h2>Dernières ventes</h2></div>`;
  if (!sales.length) h += emptyMsg('Aucune vente pour l’instant.');
  else {
    h += `<div class="card tablewrap"><table><tbody>${sales.slice(0, 60).map(s => {
      const v = s.volunteerId ? S.volunteers[s.volunteerId] : null;
      const locked = s.method === 'tab' && ((ev.tabs || {})[s.volunteerId]);
      return `<tr class="${s.voided ? 'voided' : ''}"><td class="tnum">${fmtTime(s.at)}</td><td>${METHOD_LABEL[s.method]}${v ? ' · ' + esc(v.name) : ''}${s.tablet ? ' <span class="muted">(' + esc(s.tablet) + ')</span>' : ''}</td><td>${saleSummary(s)}</td>
        <td class="r tnum"><b>${fmt(s.total)}</b></td><td class="r">${s.voided ? '<span class="badge">Annulée</span>' : (canEdit ? `<button class="btn small ghost" data-act="void" data-id="${s.id}" ${locked ? 'disabled title="Rouvrez d’abord l’ardoise"' : ''}>Annuler</button>` : '')}</td></tr>`;
    }).join('')}</tbody></table></div>${sales.length > 60 ? `<p class="muted">Les 60 dernières ventes sont affichées sur ${sales.length}. Le détail complet est dans l’export CSV du bilan.</p>` : ''}`;
  }
  return h + '</main>';
}

/* ---------- ardoises ---------- */
function tabStatusLabel(tb) {
  const st = tb.settled;
  if (!tb.consumed) return 'Rien consommé';
  if (!st) return tb.due ? 'À régler' : 'Entièrement offert';
  if (st.status === 'paid') return st.method === 'cb' ? 'Réglée par carte' : st.method === 'cash' ? 'Réglée en espèces' : 'Soldée (rien à payer)';
  return st.settledLater ? 'Réglée plus tard' : 'Laissée impayée';
}
function viewTabs(ev) {
  const vids = Object.keys(ev.volunteers).filter(id => S.volunteers[id]).sort((a, b) => byName(S.volunteers[a], S.volunteers[b]));
  const canEdit = ev.status === 'open';
  return topbar(ev, 'tabs') + `<main id="main" class="page" data-keep="main"><h1>Ardoises des bénévoles</h1>
    ${vids.length ? `<div class="card tablewrap"><table><thead><tr><th>Bénévole</th><th class="r">Consommé</th><th class="r">Crédit offert</th><th class="r">À payer</th><th>Statut</th><th></th></tr></thead><tbody>
    ${vids.map(id => {
      const tb = tabOf(ev, id), v = S.volunteers[id];
      const todo = tb.consumed > 0 && !tb.settled;
      return `<tr><td><b>${esc(v.name)}</b></td><td class="r tnum">${fmt(tb.consumed)}</td><td class="r tnum">${fmt(tb.credit)}</td>
        <td class="r tnum"><b>${tb.settled && tb.settled.status === 'paid' ? fmt(tb.settled.amount) : fmt(tb.due)}</b></td>
        <td>${todo ? `<span class="badge prep">${tabStatusLabel(tb)}</span>` : tabStatusLabel(tb)}</td>
        <td class="r">${tb.consumed > 0 ? `<button class="btn small ${todo && canEdit ? 'primary' : ''}" data-act="settle" data-id="${id}">${todo && canEdit ? 'Régler' : 'Détail'}</button>` : ''}</td></tr>`;
    }).join('')}</tbody></table></div>` : emptyMsg('Aucun bénévole sur cette manifestation. Ajoutez-en dans la préparation.')}
    <p class="muted">Le crédit offert est déduit de ce que le bénévole a consommé. Ce qu’il n’a pas utilisé est perdu.</p></main>`;
}
function settleModal(ev) {
  const T = ui.settle, v = S.volunteers[T.vid], tb = tabOf(ev, T.vid), st = tb.settled, canEdit = ev.status === 'open';
  let actions = '';
  if (st) {
    actions = `<p><b>${tabStatusLabel(tb)}</b>${st.at ? ' · ' + esc(fmtDateTime(st.at)) : ''}${st.note ? '<br>Note : ' + esc(st.note) : ''}</p>
      <div class="modal-actions"><button class="btn" data-act="modal-close">Fermer</button>${canEdit ? '<button class="btn" data-act="settle-reopen">Rouvrir l’ardoise</button>' : ''}</div>`;
  } else if (!canEdit) {
    actions = `<div class="modal-actions"><button class="btn" data-act="modal-close">Fermer</button></div>`;
  } else if (T.step === 'cash') {
    const r = T.recv === '' ? null : parseEuro(T.recv);
    actions = `${cashWidget(tb.due, T.recv)}<div class="modal-actions"><button class="btn" data-act="settle-step" data-v="choose">Retour</button><button class="btn primary big" data-act="settle-cash-ok" ${r != null && r >= tb.due ? '' : 'disabled'}>Valider</button></div>`;
  } else if (T.step === 'unpaid') {
    actions = `<label>Note (facultatif)<input class="field" id="unpaid-note" placeholder="Réglera à la prochaine réunion" autocomplete="off"></label>
      <div class="modal-actions"><button class="btn" data-act="settle-step" data-v="choose">Retour</button><button class="btn danger" data-act="settle-unpaid-ok">Laisser impayée</button></div>`;
  } else if (!tb.due) {
    actions = `<div class="modal-actions"><button class="btn" data-act="modal-close">Fermer</button><button class="btn primary big" data-act="settle-zero">Clôturer l’ardoise</button></div>`;
  } else {
    actions = `<div class="pay-methods"><button class="method cb" data-act="settle-cb">Carte bancaire</button><button class="method cash" data-act="settle-step" data-v="cash">Espèces</button></div>
      <div class="modal-actions"><button class="btn" data-act="modal-close">Fermer</button><button class="btn ghost" data-act="settle-step" data-v="unpaid">Laisser impayée</button></div>`;
  }
  return `<div class="overlay"><div class="sheet wide" role="dialog" aria-modal="true"><h2>Ardoise de ${esc(v.name)}</h2>
    <div class="sale-list">${tb.sales.map(s => `<div><span>${fmtTime(s.at)} · ${saleSummary(s)}</span><b class="tnum">${fmt(s.total)}</b></div>`).join('')}</div>
    <div class="summary"><div><span>Consommé</span><b>${fmt(tb.consumed)}</b></div><div><span>Crédit offert utilisé</span><b>− ${fmt(tb.used)}</b></div><div><span>À payer</span><b>${fmt(st && st.status === 'paid' ? st.amount : tb.due)}</b></div></div>
    ${actions}</div></div>`;
}

/* ---------- bilan ---------- */
function hourlyChart(sales) {
  const m = {};
  sales.forEach(s => { const hh = new Date(s.at).getHours(); m[hh] = (m[hh] || 0) + s.total; });
  const hs = Object.keys(m).map(Number);
  if (!hs.length) return '';
  const min = Math.min(...hs), max = Math.max(...hs), top = Math.max(...Object.values(m));
  let bars = '';
  for (let hh = min; hh <= max; hh++) {
    const v = m[hh] || 0;
    bars += `<div class="bar" title="${hh} h : ${fmt(v)}"><em>${v ? fmt(v) : ''}</em><i style="height:${Math.round((v / top) * 100)}%"></i><span>${hh} h</span></div>`;
  }
  return `<div class="bars">${bars}</div>`;
}
function tabletStats(ev) {
  const m = {};
  const row = n => m[n || '—'] || (m[n || '—'] = { name: n || '—', count: 0, revenue: 0, cb: 0, cash: 0 });
  salesOf(ev).forEach(s => { const r = row(s.tablet); r.count++; r.revenue += s.total; if (s.method === 'cb') r.cb += s.total; else if (s.method === 'cash') r.cash += s.total; });
  Object.keys(ev.tabs || {}).forEach(vid => {
    const t = ev.tabs[vid];
    if (t.status === 'paid' && t.amount) { const r = row(t.tablet); if (t.method === 'cb') r.cb += t.amount; else if (t.method === 'cash') r.cash += t.amount; }
  });
  return Object.values(m).sort((a, b) => a.name.localeCompare(b.name, 'fr'));
}
function tabletTable(ev) {
  const rows = tabletStats(ev);
  if (rows.length < 2) return '';
  return `<div class="sec-title"><h2>Par tablette</h2></div><div class="card tablewrap"><table><thead><tr><th>Tablette</th><th class="r">Ventes</th><th class="r">Chiffre d’affaires</th><th class="r">Carte</th><th class="r">Espèces encaissées</th></tr></thead><tbody>${rows.map(r => `<tr><td><b>${esc(r.name)}</b></td><td class="r tnum">${r.count}</td><td class="r tnum">${fmt(r.revenue)}</td><td class="r tnum">${fmt(r.cb)}</td><td class="r tnum">${fmt(r.cash)}</td></tr>`).join('')}</tbody></table></div><p class="muted">Le chiffre d’affaires inclut les ardoises ; les montants carte et espèces comprennent les ardoises réglées. Toutes les espèces vont dans le même tiroir-caisse.</p>`;
}
function bilanWarnings(ev) {
  let h = '';
  const stock = stockOf(ev);
  const neg = Object.keys(stock).filter(id => stock[id].left != null && stock[id].left < 0 && S.products[id]);
  if (neg.length) h += `<div class="banner warn"><div class="grow"><b>Stock négatif :</b> ${neg.map(id => esc(S.products[id].name) + ' (' + stock[id].left + ')').join(', ')}. Cela arrive quand deux tablettes vendent le dernier article en même temps. Vérifiez le stock réel.</div></div>`;
  if (ev.closedAt) {
    const late = salesOf(ev).filter(x => x.at > ev.closedAt).length;
    if (late) h += `<div class="banner warn"><div class="grow"><b>${late} vente${late > 1 ? 's' : ''} enregistrée${late > 1 ? 's' : ''} après la clôture</b> (tablette restée hors ligne). Elle${late > 1 ? 's sont' : ' est'} comptée${late > 1 ? 's' : ''} dans ce bilan : recomptez la caisse si besoin.</div></div>`;
  }
  return h;
}
function viewBilan(ev) {
  const t = totalsOf(ev), pa = productAgg(ev), stock = stockOf(ev), sales = salesOf(ev);
  const closed = ev.status === 'closed';
  const pend = pendingTabs(ev);
  const tickets = groupTickets(sum(sales, s => s.lines.length) ? [].concat(...sales.map(s => s.lines)) : []);
  const counted = ev.countedCash;
  const ecart = counted == null ? null : counted - t.cashExpected;
  let h = topbar(ev, 'bilan') + `<main id="main" class="page" data-keep="main"><div class="row sb"><h1>${closed ? 'Bilan' : 'Bilan et clôture'} · ${esc(ev.name)}</h1>
    <div class="row"><button class="btn" data-act="export-bilan">Export CSV du bilan</button><button class="btn" data-act="export-sales">CSV des ventes</button></div></div>
    <p class="muted">${esc(fmtDate(ev.date))}${ev.dateEnd ? ' au ' + esc(fmtDate(ev.dateEnd)) : ''}${ev.place ? ' · ' + esc(ev.place) : ''}</p>`;
  if (closed) h += `<div class="banner warn"><div class="grow"><b>Pensez à sauvegarder.</b> Le fichier de sauvegarde garde tout l’historique, même si la tablette est remplacée.</div><a class="btn" href="#/backup">Sauvegarder</a></div>`;
  h += bilanWarnings(ev);
  if (!closed) {
    h += `<div class="card"><h2>Clôturer la manifestation</h2>`;
    if (pend.length) {
      h += `<div class="banner warn"><div class="grow"><b>${pend.length} ardoise${pend.length > 1 ? 's' : ''} à régler</b> avant la clôture : ${pend.map(id => esc(S.volunteers[id].name)).join(', ')}.</div><a class="btn" href="#/event/${ev.id}/tabs">Régler les ardoises</a></div>`;
    }
    h += `<div class="formgrid"><label>Espèces comptées dans la caisse (€)<input id="counted" inputmode="decimal" data-chg="counted" value="${toInput(counted)}" placeholder="${toInput(t.cashExpected)}"></label>
      <div><div class="muted">Attendu en caisse</div><b class="tnum" style="font-size:1.4rem">${fmt(t.cashExpected)}</b><div class="muted">fond de caisse ${fmt(ev.floatCents)} + espèces encaissées ${fmt(t.cashTotal)}</div></div>
      <div><div class="muted">Écart</div><b id="ecart" class="tnum ${ecart ? (ecart < 0 ? 'neg' : 'pos') : ''}" style="font-size:1.4rem">${ecart == null ? '—' : fmt(ecart)}</b></div></div>
      <div class="row" style="justify-content:flex-end;margin-top:.8rem"><button class="btn primary big" data-act="ev-close" ${pend.length ? 'disabled' : ''}>Clôturer la manifestation</button></div></div>`;
  }
  h += `<div class="tiles"><div class="tile hl"><div class="k">Chiffre d’affaires</div><div class="v">${fmt(t.revenue)}</div><div class="s">${t.count} vente${t.count > 1 ? 's' : ''} · panier moyen ${fmt(t.avg)}</div></div>
    <div class="tile"><div class="k">Carte bancaire</div><div class="v">${fmt(t.cbTotal)}</div></div>
    <div class="tile"><div class="k">Espèces</div><div class="v">${fmt(t.cashTotal)}</div></div>
    <div class="tile"><div class="k">Offert aux bénévoles</div><div class="v">${fmt(t.credit)}</div></div>
    ${t.unpaid ? `<div class="tile"><div class="k">Impayé</div><div class="v neg">${fmt(t.unpaid)}</div></div>` : ''}</div>`;
  if (closed) {
    h += `<div class="card"><div class="formgrid"><div><div class="muted">Espèces attendues en caisse</div><b class="tnum">${fmt(t.cashExpected)}</b></div>
      <div><div class="muted">Espèces comptées</div><b class="tnum">${counted == null ? 'non saisi' : fmt(counted)}</b></div>
      <div><div class="muted">Écart</div><b class="tnum ${ecart ? (ecart < 0 ? 'neg' : 'pos') : ''}">${ecart == null ? '—' : fmt(ecart)}</b></div></div></div>`;
  }
  h += tabletTable(ev);
  h += `<div class="sec-title"><h2>Produits</h2></div><div class="card tablewrap"><table><thead><tr><th>Produit</th><th class="r">Vendus</th><th class="r">CA</th><th class="r">Carte</th><th class="r">Espèces</th><th class="r">Ardoise</th><th class="r">Départ</th><th class="r">Reste</th></tr></thead><tbody>
    ${Object.keys(ev.products).map(id => S.products[id]).filter(Boolean).sort(sortProducts).map(p => {
      const a = pa[p.id] || { qty: 0, revenue: 0, cb: 0, cash: 0, tab: 0 }, s = stock[p.id];
      return `<tr><td><b>${esc(p.name)}</b></td><td class="r tnum">${a.qty}</td><td class="r tnum">${fmt(a.revenue)}</td><td class="r tnum">${a.cb}</td><td class="r tnum">${a.cash}</td><td class="r tnum">${a.tab}</td>
        <td class="r tnum">${s.start == null ? '—' : s.start + (s.restock ? ' +' + s.restock : '')}</td><td class="r tnum">${s.left == null ? '—' : s.left}</td></tr>`;
    }).join('')}</tbody></table></div>`;
  h += `<div class="sec-title"><h2>Tickets remis</h2></div><div class="card">${tickets.length ? tickets.map(([n, q]) => `<span class="badge" style="font-size:1rem;margin:.15rem">${q} × ${esc(n)}</span>`).join(' ') : emptyMsg('Aucun ticket remis.')}</div>`;
  const vids = Object.keys(ev.volunteers).filter(id => S.volunteers[id] && tabOf(ev, id).consumed > 0);
  if (vids.length) {
    h += `<div class="sec-title"><h2>Bénévoles</h2></div><div class="card tablewrap"><table><thead><tr><th>Bénévole</th><th class="r">Consommé</th><th class="r">Offert</th><th class="r">À payer</th><th>Statut</th></tr></thead><tbody>
    ${vids.sort((a, b) => byName(S.volunteers[a], S.volunteers[b])).map(id => {
      const tb = tabOf(ev, id);
      return `<tr><td><b>${esc(S.volunteers[id].name)}</b></td><td class="r tnum">${fmt(tb.consumed)}</td><td class="r tnum">${fmt(tb.used)}</td><td class="r tnum">${fmt(tb.due)}</td><td>${tabStatusLabel(tb)}</td></tr>`;
    }).join('')}</tbody></table></div>`;
  }
  const chart = hourlyChart(sales);
  if (chart) h += `<div class="sec-title"><h2>Ventes par heure</h2></div><div class="card">${chart}</div>`;
  if (closed) h += `<div class="row" style="margin-top:1rem"><button class="btn" data-act="ev-reopen">Rouvrir la manifestation</button></div>`;
  return h + '</main>';
}

/* ---------- historique ---------- */
function viewHistory() {
  const closed = list('events').filter(e => e.status === 'closed').sort((a, b) => (a.date < b.date ? 1 : -1));
  const unpaid = [];
  closed.forEach(ev => Object.keys(ev.tabs || {}).forEach(vid => {
    const st = ev.tabs[vid];
    if (st.status === 'unpaid' && S.volunteers[vid]) unpaid.push({ ev, vid, st });
  }));
  let h = topbar(null) + `<main id="main" class="page" data-keep="main"><div class="row sb"><h1>Historique</h1>${closed.length > 1 ? '<a class="btn primary" href="#/compare">Comparer deux éditions</a>' : ''}</div>`;
  if (!closed.length) h += emptyMsg('Les manifestations terminées apparaîtront ici.');
  else {
    h += `<div class="card tablewrap"><table><thead><tr><th>Manifestation</th><th>Date</th><th class="r">Ventes</th><th class="r">CA</th><th class="r">Carte</th><th class="r">Espèces</th><th></th></tr></thead><tbody>
    ${closed.map(ev => {
      const t = totalsOf(ev);
      return `<tr><td><b>${esc(ev.name)}</b></td><td>${esc(fmtDate(ev.date))}</td><td class="r tnum">${t.count}</td><td class="r tnum"><b>${fmt(t.revenue)}</b></td><td class="r tnum">${fmt(t.cbTotal)}</td><td class="r tnum">${fmt(t.cashTotal)}</td>
        <td class="r"><a class="btn small" href="#/event/${ev.id}/bilan">Bilan</a> <button class="btn small ghost" data-act="ev-dup" data-id="${ev.id}">Dupliquer</button></td></tr>`;
    }).join('')}</tbody></table></div>`;
  }
  if (unpaid.length) {
    h += `<div class="sec-title"><h2>Ardoises restées impayées</h2></div><div class="card tablewrap"><table><tbody>${unpaid.map(({ ev, vid, st }) =>
      `<tr><td><b>${esc(S.volunteers[vid].name)}</b></td><td>${esc(ev.name)}</td><td class="r tnum"><b>${fmt(st.amount)}</b></td><td>${esc(st.note || '')}</td>
      <td class="r">${st.settledLater ? '<span class="badge open">Réglée hors caisse</span>' : `<button class="btn small" data-act="later-paid" data-ev="${ev.id}" data-id="${vid}">Marquer comme réglée</button>`}</td></tr>`).join('')}</tbody></table></div>`;
  }
  return h + '</main>';
}
function viewCompare() {
  const closed = list('events').filter(e => e.status === 'closed').sort((a, b) => (a.date < b.date ? 1 : -1));
  if (!ui.cmp.a && closed[1]) ui.cmp.a = closed[1].id;
  if (!ui.cmp.b && closed[0]) ui.cmp.b = closed[0].id;
  const A = S.events[ui.cmp.a], B = S.events[ui.cmp.b];
  const opts = sel => closed.map(e => `<option value="${e.id}" ${e.id === sel ? 'selected' : ''}>${esc(e.name)} (${esc(fmtDate(e.date))})</option>`).join('');
  let h = topbar(null) + `<main id="main" class="page" data-keep="main"><h1>Comparer deux éditions</h1>
    <div class="card"><div class="formgrid"><label>Édition A<select data-chg="cmp" data-f="a">${opts(ui.cmp.a)}</select></label><label>Édition B<select data-chg="cmp" data-f="b">${opts(ui.cmp.b)}</select></label></div></div>`;
  if (!A || !B) return h + emptyMsg('Il faut au moins deux manifestations terminées.') + '</main>';
  const tA = totalsOf(A), tB = totalsOf(B), pA = productAgg(A), pB = productAgg(B);
  const delta = (a, b, money = true) => { const d = b - a; return `<td class="r tnum ${d > 0 ? 'pos' : d < 0 ? 'neg' : ''}">${d > 0 ? '+' : ''}${money ? fmt(d) : d}</td>`; };
  const rows = [['Chiffre d’affaires', 'revenue'], ['Carte bancaire', 'cbTotal'], ['Espèces', 'cashTotal'], ['Offert aux bénévoles', 'credit'], ['Impayé', 'unpaid'], ['Panier moyen', 'avg']];
  h += `<div class="card tablewrap"><table><thead><tr><th></th><th class="r">${esc(A.name)}</th><th class="r">${esc(B.name)}</th><th class="r">Écart</th></tr></thead><tbody>
    ${rows.map(([l, k]) => `<tr><td>${l}</td><td class="r tnum">${fmt(tA[k])}</td><td class="r tnum">${fmt(tB[k])}</td>${delta(tA[k], tB[k])}</tr>`).join('')}
    <tr><td>Nombre de ventes</td><td class="r tnum">${tA.count}</td><td class="r tnum">${tB.count}</td>${delta(tA.count, tB.count, false)}</tr></tbody></table></div>`;
  const ids = [...new Set([...Object.keys(pA), ...Object.keys(pB)])];
  const nm = id => (pB[id] || pA[id]).name;
  ids.sort((x, y) => ((pB[y] || { qty: 0 }).qty + (pA[y] || { qty: 0 }).qty) - ((pB[x] || { qty: 0 }).qty + (pA[x] || { qty: 0 }).qty));
  h += `<div class="sec-title"><h2>Quantités vendues par produit</h2></div><div class="card tablewrap"><table><thead><tr><th>Produit</th><th class="r">A</th><th class="r">B</th><th class="r">Écart</th></tr></thead><tbody>
    ${ids.map(id => { const a = (pA[id] || { qty: 0 }).qty, b = (pB[id] || { qty: 0 }).qty; return `<tr><td><b>${esc(nm(id))}</b></td><td class="r tnum">${a}</td><td class="r tnum">${b}</td>${delta(a, b, false)}</tr>`; }).join('')}</tbody></table></div>`;
  return h + '</main>';
}

/* ---------- sauvegarde ---------- */
function backupDangerCards() {
  if (Sync.linked()) return `<div class="card"><h2>Restaurer et effacer</h2><p class="muted">Indisponibles tant que cette tablette est synchronisée, car elles écraseraient les données des autres tablettes. Pour restaurer une sauvegarde, quittez d’abord la synchronisation (écran Plusieurs tablettes).</p></div>`;
  return `<div class="card"><h2>Restaurer</h2><p>Recharge un fichier de sauvegarde, par exemple sur une nouvelle tablette. <b>Les données actuelles de cette tablette sont remplacées.</b></p>
      <input type="file" id="restore-file" accept=".json,application/json,text/plain" hidden>
      <button class="btn" data-act="restore-pick">Choisir un fichier de sauvegarde</button></div>
    <div class="card"><h2>Effacer</h2><p>Supprime toutes les données de cette tablette (par exemple pour retirer le jeu d’exemple). Faites une sauvegarde avant.</p>
      <button class="btn danger" data-act="wipe">Tout effacer</button></div>`;
}
function viewBackup() {
  const m = getMeta();
  return topbar(null) + `<main id="main" class="page" data-keep="main"><h1>Sauvegarde et restauration</h1>${storageBanner()}
    <div class="card"><h2>Sauvegarder</h2><p>Le fichier contient tout : catalogue, bénévoles, manifestations, ventes et ardoises. Déposez-le sur Google Drive ou envoyez-le par mail.</p>
      <p class="muted">${m.lastBackupAt ? 'Dernière sauvegarde : ' + esc(fmtDateTime(m.lastBackupAt)) : 'Aucune sauvegarde pour l’instant.'} <span id="persist-state"></span></p>
      <div class="row"><button class="btn primary" data-act="backup-share">Envoyer (Drive, mail…)</button><button class="btn" data-act="backup-dl">Télécharger le fichier</button></div></div>
    ${backupDangerCards()}</main>`;
}

/* ========== fenêtres modales ========== */
function modalHTML(ev) {
  const M = ui.modal;
  if (!M) return '';
  let inner = '';
  if (M.type === 'confirm') {
    inner = `<h2>${esc(M.title || 'Confirmer')}</h2><p>${M.text}</p><div class="modal-actions"><button class="btn" data-act="modal-close">${esc(M.noLabel || 'Annuler')}</button><button class="btn ${M.danger ? 'danger' : 'primary'}" data-act="confirm-yes">${esc(M.yesLabel || 'Confirmer')}</button></div>`;
  } else if (M.type === 'text') {
    inner = `<form data-form="text"><h2>${esc(M.title)}</h2><label>${esc(M.label || 'Nom')}<input name="v" value="${esc(M.value || '')}" required autocomplete="off" data-autofocus></label>
      <div class="modal-actions"><button type="button" class="btn" data-act="modal-close">Annuler</button><button class="btn primary">Enregistrer</button></div></form>`;
  } else if (M.type === 'product') {
    const p = S.products[M.id];
    const shared = list('tickets').filter(t => t.shared).sort(byName);
    const cur = S.tickets[p.ticketId] && S.tickets[p.ticketId].shared ? p.ticketId : 'own';
    const cats = [...new Set(list('products').map(x => x.category))];
    inner = `<form data-form="product" data-id="${p.id}"><h2>Modifier le produit</h2><div class="formgrid">
      <label>Nom<input name="name" required value="${esc(p.name)}" data-autofocus></label>
      <label>Catégorie<input name="category" list="cats2" value="${esc(p.category)}"></label><datalist id="cats2">${cats.map(c => `<option value="${esc(c)}">`).join('')}</datalist>${catPicker(cats.sort((a, b) => a.localeCompare(b, 'fr')), p.category)}
      <label>Prix (€)<input name="price" inputmode="decimal" required value="${toInput(p.price)}"></label>
      <label>Ticket remis<select name="ticket"><option value="own" ${cur === 'own' ? 'selected' : ''}>Ticket propre</option>${shared.map(t => `<option value="${t.id}" ${cur === t.id ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select></label></div>
      <fieldset class="swatches"><legend>Couleur du bouton</legend>${COLOR_KEYS.map(k => `<label><input type="radio" name="color" value="${k}" ${p.color === k ? 'checked' : ''}><span style="--c:${COLORS[k]}" title="${k}"></span></label>`).join('')}</fieldset>
      <div class="modal-actions"><button type="button" class="btn" data-act="modal-close">Annuler</button><button class="btn primary">Enregistrer</button></div></form>`;
  } else if (M.type === 'newevent') {
    const evs = list('events').sort((a, b) => (a.date < b.date ? 1 : -1));
    inner = `<form data-form="newevent"><h2>Nouvelle manifestation</h2><div class="formgrid">
      <label>Nom<input name="name" required autocomplete="off" data-autofocus placeholder="Fête de la bière"></label>
      <label>Date<input type="date" name="date" value="${localDate()}" required></label></div>
      <label>Partir d’une manifestation existante<select name="from"><option value="">Non, partir de zéro</option>${evs.map(e => `<option value="${e.id}" ${e.id === M.from ? 'selected' : ''}>${esc(e.name)} (${esc(fmtDate(e.date))})</option>`).join('')}</select></label>
      <p class="muted">En partant d’une édition passée, on reprend ses produits, prix, stocks, bénévoles et crédits. Les ventes ne sont pas copiées.</p>
      <div class="modal-actions"><button type="button" class="btn" data-act="modal-close">Annuler</button><button class="btn primary">Créer</button></div></form>`;
  } else if (M.type === 'restock') {
    const p = S.products[M.id];
    inner = `<form data-form="restock" data-id="${p.id}"><h2>Réassort : ${esc(p.name)}</h2>
      ${stockOf(ev)[p.id] && stockOf(ev)[p.id].tracked
        ? '<label>Quantité ajoutée (négative pour corriger)<input name="qty" inputmode="numeric" required autocomplete="off" data-autofocus placeholder="24"></label>'
        : '<p class="muted">Le stock de ce produit n’était pas suivi. Indiquez la quantité réellement en stock <b>maintenant</b> : le suivi démarre à partir de cet instant, les ventes déjà faites ne sont pas décomptées.</p><label>Quantité en stock maintenant<input name="qty" inputmode="numeric" required autocomplete="off" data-autofocus placeholder="12"></label>'}
      <div class="modal-actions"><button type="button" class="btn" data-act="modal-close">Annuler</button><button class="btn primary">Ajouter au stock</button></div></form>`;
  } else if (M.type === 'settle') {
    return settleModal(ev);
  }
  return `<div class="overlay top2"><div class="modal" role="dialog" aria-modal="true">${inner}</div></div>`;
}

/* ========== affichage ========== */
const app = document.getElementById('app');
let lastRoute = null;
const currentRoute = () => location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
const curEvent = () => { const p = currentRoute(); return p[0] === 'event' ? S.events[p[1]] : null; };
function go(hash) { if (location.hash === hash) render(); else location.hash = hash; }

function render() {
  const p = currentRoute();
  const key = p.join('/');
  const scr = {};
  document.querySelectorAll('[data-keep]').forEach(el => { scr[el.dataset.keep] = el.scrollTop; });
  let html = '', ev = null;
  try {
    switch (p[0]) {
      case undefined: html = viewHome(); break;
      case 'catalog': html = viewCatalog(); break;
      case 'volunteers': html = viewVolunteers(); break;
      case 'history': html = viewHistory(); break;
      case 'compare': html = viewCompare(); break;
      case 'backup': html = viewBackup(); break;
      case 'sync': html = viewSync(); Sync.onSyncScreen(); break;
      case 'event': {
        ev = S.events[p[1]];
        if (!ev) { html = topbar(null) + '<main class="page"><div class="card"><h2>Manifestation introuvable</h2><a class="btn" href="#/">Retour à l’accueil</a></div></main>'; break; }
        let sc = p[2] || (ev.status === 'open' ? 'cash' : ev.status === 'closed' ? 'bilan' : 'prep');
        if (ev.status === 'closed' && (sc === 'cash' || sc === 'prep')) sc = 'bilan';
        if (ev.status === 'prep') sc = 'prep';
        html = { cash: viewCash, prep: viewPrep, monitor: viewMonitor, tabs: viewTabs, bilan: viewBilan }[sc](ev);
        break;
      }
      default: html = viewHome();
    }
  } catch (e) {
    console.error(e);
    html = `<main class="page"><div class="card"><h2>Erreur d’affichage</h2><p>${esc(e.message)}</p><a class="btn" href="#/">Accueil</a></div></main>`;
  }
  if (ui.pay && ev) html += payHTML(ev);
  html += modalHTML(ev);
  app.innerHTML = html;
  const same = key === lastRoute;
  document.querySelectorAll('[data-keep]').forEach(el => { if (same && scr[el.dataset.keep] != null) el.scrollTop = scr[el.dataset.keep]; });
  const inModal = document.querySelector('.overlay [data-autofocus]');
  const page = document.querySelector('main [data-autofocus]');
  const target = inModal || (!ui.pay && !ui.modal && (!same || ui.focusPage) ? page : null);
  if (target) target.focus();
  ui.focusPage = false;
  lastRoute = key;
  if (p[0] === 'backup' && navigator.storage && navigator.storage.persisted) {
    navigator.storage.persisted().then(ok => { const s = document.getElementById('persist-state'); if (s) s.textContent = ok ? '· Stockage protégé par le navigateur.' : '· Stockage non protégé : la sauvegarde est indispensable.'; });
  }
}

/* ========== actions (clics) ========== */
const ACT = {};
function confirmModal(o) { ui.modal = Object.assign({ type: 'confirm' }, o); render(); }
function askText(o) { ui.modal = Object.assign({ type: 'text' }, o); render(); }
function closeModal() { ui.modal = null; ui.settle = null; }

ACT['modal-close'] = () => { closeModal(); render(); };
ACT['confirm-yes'] = () => { const fn = ui.modal.fn; ui.modal = null; fn(); };

/* panier */
function addToCart(id) {
  const ev = curEvent();
  const left = stockOf(ev)[id].left;
  const c = ui.cart.find(x => x.pid === id);
  if (left != null && (c ? c.qty : 0) + 1 > left) { toast('Stock épuisé'); return; }
  if (c) c.qty++; else ui.cart.push({ pid: id, qty: 1 });
  persistCart(ev.id); render();
}
ACT.add = el => addToCart(el.dataset.id);
ACT.inc = el => addToCart(el.dataset.id);
ACT.dec = el => {
  const c = ui.cart.find(x => x.pid === el.dataset.id);
  if (c && --c.qty <= 0) ui.cart = ui.cart.filter(x => x !== c);
  persistCart(curEvent().id); render();
};
ACT['cart-clear'] = () => { ui.cart = []; persistCart(curEvent().id); render(); };
ACT.filter = el => { ui.filter = el.dataset.v; render(); };

/* paiement */
ACT['pay-start'] = () => { ui.pay = { step: 'method', total: cartTotal(curEvent()), recv: '' }; render(); };
ACT['pay-cancel'] = () => { ui.pay = null; render(); };
ACT['pay-step'] = el => { ui.pay.step = el.dataset.v; if (el.dataset.v === 'cash') ui.pay.recv = ''; render(); };
function finishSale(method, extra) {
  const ev = curEvent(), st = stockOf(ev);
  for (const c of ui.cart) {
    const l = st[c.pid].left;
    if (l != null && c.qty > l) { toast(`Stock insuffisant : ${S.products[c.pid].name}`); ui.pay = null; render(); return; }
  }
  const sale = recordSale(ev, ui.cart, method, extra);
  ui.cart = []; persistCart(ev.id);
  ui.pay = { step: 'done', sale };
  render();
}
ACT['pay-cb-ok'] = () => finishSale('cb', {});
ACT['pay-cash-ok'] = () => {
  const r = parseEuro(ui.pay.recv);
  if (r == null || r < ui.pay.total) return;
  finishSale('cash', { received: r, change: r - ui.pay.total });
};
ACT['pay-vol'] = el => { ui.pay.volunteerId = el.dataset.id; ui.pay.step = 'tabconfirm'; render(); };
ACT['pay-tab-ok'] = () => finishSale('tab', { volunteerId: ui.pay.volunteerId });
ACT['pay-vol-new'] = () => askText({
  title: 'Nouveau bénévole', label: 'Nom ou prénom',
  fn: name => {
    const ev = curEvent();
    const v = save('volunteers', { id: uid(), name: name.trim(), active: true });
    ev.volunteers[v.id] = { credit: ev.defaultCredit || 0 }; save('events', ev);
    ui.modal = null; render();
  },
});
ACT['pay-next'] = () => { ui.pay = null; render(); };
ACT['sale-undo'] = () => {
  const sale = ui.pay.sale, ev = curEvent();
  sale.voided = true; sale.voidedAt = new Date().toISOString(); save('sales', sale);
  ui.cart = sale.lines.map(l => ({ pid: l.productId, qty: l.qty }));
  persistCart(ev.id); ui.pay = null;
  toast('Vente annulée : la commande est revenue dans le panier.'); render();
};
function cashTarget() { return ui.pay && ui.pay.step === 'cash' ? ui.pay : ui.settle; }
ACT.key = el => {
  const t = cashTarget(); if (!t) return;
  const k = el.dataset.k;
  let s = t.recv || '';
  if (k === 'back') s = s.slice(0, -1);
  else if (k === 'clear') s = '';
  else if (k === ',') { if (!s.includes(',')) s = (s || '0') + ','; }
  else {
    const dec = s.split(',')[1];
    if ((dec != null && dec.length >= 2) || s.length >= 8) return;
    s = (s === '0' ? '' : s) + k;
  }
  t.recv = s; render();
};
ACT.bill = el => { cashTarget().recv = el.dataset.v; render(); };
ACT.exact = () => {
  const t = cashTarget();
  const due = ui.pay && ui.pay.step === 'cash' ? ui.pay.total : tabOf(curEvent(), ui.settle.vid).due;
  t.recv = toInput(due); render();
};

/* manifestations */
ACT['ev-new'] = () => { ui.modal = { type: 'newevent' }; render(); };
ACT['ev-dup'] = el => { ui.modal = { type: 'newevent', from: el.dataset.id }; render(); };
ACT['ev-delete'] = el => {
  const ev = S.events[el.dataset.id];
  confirmModal({ title: 'Supprimer la manifestation ?', text: `« ${esc(ev.name)} » et sa préparation seront supprimées.`, yesLabel: 'Supprimer', danger: true, fn: () => { del('events', ev.id); render(); } });
};
ACT['ev-open'] = () => {
  const ev = curEvent();
  ev.status = 'open'; ev.openedAt = new Date().toISOString(); save('events', ev);
  go(`#/event/${ev.id}/cash`);
};
ACT['ev-close'] = () => {
  const ev = curEvent();
  confirmModal({
    title: 'Clôturer la manifestation ?', yesLabel: 'Clôturer',
    text: 'Plus aucune vente ne pourra être ajoutée. Vous pourrez rouvrir la manifestation si besoin.',
    fn: () => { ev.status = 'closed'; ev.closedAt = new Date().toISOString(); save('events', ev); ui.cart = []; persistCart(ev.id); toast('Manifestation clôturée'); render(); },
  });
};
ACT['ev-reopen'] = () => {
  const ev = curEvent();
  confirmModal({ title: 'Rouvrir la manifestation ?', text: 'La caisse redevient utilisable.', yesLabel: 'Rouvrir', fn: () => { ev.status = 'open'; delete ev.closedAt; save('events', ev); go(`#/event/${ev.id}/cash`); } });
};
ACT['prod-all'] = el => {
  const ev = curEvent(), on = el.dataset.v === '1';
  const sold = new Set(); salesOf(ev, true).forEach(s => s.lines.forEach(l => sold.add(l.productId)));
  list('products').filter(p => p.active).forEach(p => {
    if (on && !ev.products[p.id]) ev.products[p.id] = { price: p.price, stock: null };
    if (!on && ev.products[p.id] && !sold.has(p.id)) delete ev.products[p.id];
  });
  save('events', ev); render();
};
ACT['credit-apply'] = () => {
  const ev = curEvent();
  Object.keys(ev.volunteers).forEach(id => { ev.volunteers[id].credit = ev.defaultCredit || 0; });
  save('events', ev); render(); toast('Crédit appliqué à tous les présents');
};

/* catalogue, tickets, bénévoles */
ACT['p-edit'] = el => { ui.modal = { type: 'product', id: el.dataset.id }; render(); };
ACT['p-archive'] = el => { const p = S.products[el.dataset.id]; p.active = false; save('products', p); render(); };
ACT['p-restore'] = el => { const p = S.products[el.dataset.id]; p.active = true; save('products', p); render(); };
ACT['t-add'] = () => askText({ title: 'Nouveau ticket partagé', label: 'Nom du ticket (ex. Boisson)', fn: name => { save('tickets', { id: uid(), name: name.trim(), shared: true }); ui.modal = null; render(); } });
ACT['t-rename'] = el => { const t = S.tickets[el.dataset.id]; askText({ title: 'Renommer le ticket', label: 'Nom du ticket', value: t.name, fn: name => { t.name = name.trim(); save('tickets', t); ui.modal = null; render(); } }); };
ACT['t-del'] = el => { del('tickets', el.dataset.id); render(); };
ACT['v-rename'] = el => { const v = S.volunteers[el.dataset.id]; askText({ title: 'Renommer le bénévole', label: 'Nom', value: v.name, fn: name => { v.name = name.trim(); save('volunteers', v); ui.modal = null; render(); } }); };
ACT['v-archive'] = el => { const v = S.volunteers[el.dataset.id]; v.active = false; save('volunteers', v); render(); };
ACT['v-restore'] = el => { const v = S.volunteers[el.dataset.id]; v.active = true; save('volunteers', v); render(); };

/* suivi */
ACT.restock = el => { ui.modal = { type: 'restock', id: el.dataset.id }; render(); };
ACT.void = el => {
  const s = S.sales[el.dataset.id];
  confirmModal({
    title: 'Annuler cette vente ?', yesLabel: 'Annuler la vente', danger: true, noLabel: 'Garder',
    text: `${fmtTime(s.at)} · ${saleSummary(s)} · <b>${fmt(s.total)}</b><br>Les articles retournent en stock et la vente n’est plus comptée.`,
    fn: () => { s.voided = true; s.voidedAt = new Date().toISOString(); save('sales', s); toast('Vente annulée'); render(); },
  });
};

/* ardoises */
ACT.settle = el => { ui.settle = { vid: el.dataset.id, step: 'choose', recv: '' }; ui.modal = { type: 'settle' }; render(); };
ACT['settle-step'] = el => { ui.settle.step = el.dataset.v; ui.settle.recv = ''; render(); };
function settleTab(rec) {
  const ev = curEvent(), tb = tabOf(ev, ui.settle.vid);
  if (ev.tabs[ui.settle.vid]) { toast('Cette ardoise vient d’être réglée sur une autre tablette.'); closeModal(); render(); return; }
  ev.tabs[ui.settle.vid] = Object.assign({ at: new Date().toISOString(), amount: tb.due }, Sync.tabletName() ? { tablet: Sync.tabletName() } : {}, rec);
  save('events', ev); closeModal(); toast('Ardoise enregistrée'); render();
}
ACT['settle-cb'] = () => settleTab({ status: 'paid', method: 'cb' });
ACT['settle-cash-ok'] = () => {
  const due = tabOf(curEvent(), ui.settle.vid).due, r = parseEuro(ui.settle.recv);
  if (r == null || r < due) return;
  settleTab({ status: 'paid', method: 'cash', received: r, change: r - due });
};
ACT['settle-zero'] = () => settleTab({ status: 'paid', method: 'none' });
ACT['settle-unpaid-ok'] = () => settleTab({ status: 'unpaid', note: ($('#unpaid-note').value || '').trim() });
ACT['settle-reopen'] = () => { const ev = curEvent(); delete ev.tabs[ui.settle.vid]; save('events', ev); ui.settle.step = 'choose'; render(); };
ACT['later-paid'] = el => {
  const ev = S.events[el.dataset.ev], st = ev.tabs[el.dataset.id];
  st.settledLater = true; st.laterAt = new Date().toISOString(); save('events', ev); render();
};

/* ========== formulaires ========== */
const FORM = {};
FORM.quickprod = (f, fd) => {
  const price = parseEuro(fd.get('price')), name = fd.get('name').trim();
  if (!name || price == null || price < 0) { toast('Indiquez un nom et un prix.'); return; }
  const category = (fd.get('category') || '').trim() || 'Divers';
  createProduct({ name, category, price, ticket: fd.get('ticket') });
  ui.lastCategory = category; ui.lastTicket = fd.get('ticket'); ui.focusPage = true;
  toast(`« ${name} » ajouté`); render();
};
FORM.product = (f, fd) => {
  const p = S.products[f.dataset.id], price = parseEuro(fd.get('price'));
  if (price == null || price < 0) { toast('Prix invalide.'); return; }
  p.name = fd.get('name').trim() || p.name;
  p.category = (fd.get('category') || '').trim() || 'Divers';
  p.price = price; p.color = fd.get('color') || p.color;
  applyTicket(p, fd.get('ticket'));
  save('products', p); ui.modal = null; render();
};
FORM['vol-add'] = (f, fd) => {
  const name = fd.get('name').trim(); if (!name) return;
  save('volunteers', { id: uid(), name, active: true });
  ui.focusPage = true; render();
};
FORM['prep-vol-add'] = (f, fd) => {
  const name = fd.get('name').trim(); if (!name) return;
  const ev = curEvent(), v = save('volunteers', { id: uid(), name, active: true });
  ev.volunteers[v.id] = { credit: ev.defaultCredit || 0 }; save('events', ev); render();
};
FORM.newevent = (f, fd) => {
  const ev = createEvent({ name: fd.get('name').trim(), date: fd.get('date'), from: fd.get('from') });
  ui.modal = null; go(`#/event/${ev.id}/prep`);
};
FORM.restock = (f, fd) => {
  const qty = parseInt(fd.get('qty'), 10), ev = curEvent();
  if (!qty) { toast('Indiquez une quantité.'); return; }
  const st0 = stockOf(ev)[f.dataset.id];
  if (st0 && !st0.tracked && qty < 0) { toast('Indiquez une quantité positive.'); return; }
  const rid = uid();
  ev.restocks[rid] = { id: rid, productId: f.dataset.id, qty, at: new Date().toISOString(), tablet: Sync.tabletName() };
  save('events', ev); ui.modal = null; toast('Stock mis à jour'); render();
};
FORM.text = (f, fd) => { const v = fd.get('v').trim(); if (v) ui.modal.fn(v); };

/* ========== champs modifiés (enregistrement immédiat) ========== */
const CHG = {};
CHG.evf = el => {
  const ev = curEvent(), f = el.dataset.f;
  let v = el.value;
  if (f === 'floatCents' || f === 'defaultCredit') { const c = parseEuro(v); v = c == null ? 0 : Math.max(0, c); el.value = toInput(v); }
  else if (f === 'name') { v = v.trim() || ev.name; el.value = v; const t = document.querySelector('.evtitle strong'); if (t) t.textContent = v; }
  ev[f] = v; save('events', ev);
};
CHG.evinc = el => {
  const ev = curEvent(), p = S.products[el.dataset.id];
  if (el.checked) ev.products[p.id] = { price: p.price, stock: null };
  else if (salesOf(ev, true).some(s => s.lines.some(l => l.productId === p.id))) toast('Ce produit a déjà été vendu : il reste dans la manifestation.');
  else delete ev.products[p.id];
  save('events', ev); render();
};
CHG.evprice = el => {
  const ev = curEvent(), cfg = ev.products[el.dataset.id], c = parseEuro(el.value);
  if (c == null || c < 0) { toast('Prix invalide.'); el.value = toInput(cfg.price); return; }
  cfg.price = c; el.value = toInput(c); save('events', ev);
};
CHG.evstock = el => {
  const ev = curEvent(), cfg = ev.products[el.dataset.id], v = el.value.trim();
  const n = parseInt(v, 10);
  cfg.stock = v === '' || isNaN(n) ? null : Math.max(0, n);
  el.value = cfg.stock == null ? '' : cfg.stock; save('events', ev);
};
CHG.evvol = el => {
  const ev = curEvent(), id = el.dataset.id;
  if (el.checked) ev.volunteers[id] = { credit: ev.defaultCredit || 0 };
  else if (tabOf(ev, id).consumed > 0) toast('Ce bénévole a déjà une consommation : il reste dans la manifestation.');
  else delete ev.volunteers[id];
  save('events', ev); render();
};
CHG.evcredit = el => {
  const ev = curEvent(), c = parseEuro(el.value);
  ev.volunteers[el.dataset.id].credit = c == null ? 0 : Math.max(0, c);
  el.value = toInput(ev.volunteers[el.dataset.id].credit); save('events', ev);
};
CHG.counted = el => { const ev = curEvent(); ev.countedCash = parseEuro(el.value); save('events', ev); updateEcart(); };
CHG.cmp = el => { ui.cmp[el.dataset.f] = el.value; render(); };
function updateEcart() {
  const ev = curEvent(), out = document.getElementById('ecart'), inp = document.getElementById('counted');
  if (!ev || !out || !inp) return;
  const c = parseEuro(inp.value), exp = totalsOf(ev).cashExpected;
  out.textContent = c == null ? '—' : fmt(c - exp);
  out.className = 'tnum ' + (c == null || c === exp ? '' : c < exp ? 'neg' : 'pos');
}

/* ========== exports et sauvegardes ========== */
const slug = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'export';
const csvCell = c => { c = String(c ?? ''); return /[";\r\n]/.test(c) ? '"' + c.replace(/"/g, '""') + '"' : c; };
const csv = rows => '﻿' + rows.map(r => r.map(csvCell).join(';')).join('\r\n');
const money = c => (c / 100).toFixed(2).replace('.', ',');
function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1500);
}
ACT['export-bilan'] = () => {
  const ev = curEvent(), t = totalsOf(ev), pa = productAgg(ev), stock = stockOf(ev);
  const rows = [['Manifestation', ev.name], ['Date', ev.date], ['Lieu', ev.place], [],
    ['Chiffre d’affaires', money(t.revenue)], ['Nombre de ventes', t.count], ['Panier moyen', money(t.avg)],
    ['Encaissé carte bancaire', money(t.cbTotal)], ['Encaissé espèces', money(t.cashTotal)], ['Crédit offert aux bénévoles', money(t.credit)], ['Impayé', money(t.unpaid)],
    ['Fond de caisse', money(ev.floatCents || 0)], ['Espèces attendues en caisse', money(t.cashExpected)],
    ['Espèces comptées', ev.countedCash == null ? '' : money(ev.countedCash)], ['Écart', ev.countedCash == null ? '' : money(ev.countedCash - t.cashExpected)], [],
    ['Produit', 'Vendus', 'CA', 'Carte', 'Espèces', 'Ardoise', 'Stock départ', 'Réassort', 'Reste']];
  Object.keys(ev.products).map(id => S.products[id]).filter(Boolean).sort(sortProducts).forEach(p => {
    const a = pa[p.id] || { qty: 0, revenue: 0, cb: 0, cash: 0, tab: 0 }, s = stock[p.id];
    rows.push([p.name, a.qty, money(a.revenue), a.cb, a.cash, a.tab, s.start ?? '', s.restock, s.left ?? '']);
  });
  rows.push([], ['Bénévole', 'Consommé', 'Crédit offert utilisé', 'À payer', 'Statut']);
  Object.keys(ev.volunteers).filter(id => S.volunteers[id]).forEach(id => {
    const tb = tabOf(ev, id); if (!tb.consumed) return;
    rows.push([S.volunteers[id].name, money(tb.consumed), money(tb.used), money(tb.due), tabStatusLabel(tb)]);
  });
  rows.push([], ['Ticket', 'Quantité remis']);
  groupTickets([].concat(...salesOf(ev).map(s => s.lines))).forEach(([n, q]) => rows.push([n, q]));
  rows.push([], ['Tablette', 'Ventes', 'Chiffre d’affaires', 'Carte', 'Espèces encaissées']);
  tabletStats(ev).forEach(r => rows.push([r.name, r.count, money(r.revenue), money(r.cb), money(r.cash)]));
  download(`bilan-${slug(ev.name)}-${ev.date}.csv`, csv(rows), 'text/csv;charset=utf-8');
};
ACT['export-sales'] = () => {
  const ev = curEvent();
  const rows = [['Date', 'Heure', 'Mode de paiement', 'Bénévole', 'Produit', 'Quantité', 'Prix unitaire', 'Total ligne', 'Total vente', 'Annulée', 'Tablette']];
  salesOf(ev, true).forEach(s => {
    const d = new Date(s.at), v = s.volunteerId && S.volunteers[s.volunteerId];
    s.lines.forEach(l => rows.push([localDate(d), fmtTime(s.at), METHOD_LABEL[s.method], v ? v.name : '', l.name, l.qty, money(l.price), money(l.qty * l.price), money(s.total), s.voided ? 'oui' : '', s.tablet || '']));
  });
  download(`ventes-${slug(ev.name)}-${ev.date}.csv`, csv(rows), 'text/csv;charset=utf-8');
};
function backupJSON() {
  const data = {};
  STORES.forEach(s => { data[s] = list(s); });
  return JSON.stringify({ app: 'caisse-manifestation', version: 1, exportedAt: new Date().toISOString(), data });
}
const backupName = () => `caisse-sauvegarde-${localDate()}.json`;
ACT['backup-dl'] = () => {
  download(backupName(), backupJSON(), 'application/json');
  setMeta({ lastBackupAt: new Date().toISOString() }); toast('Fichier de sauvegarde téléchargé'); render();
};
ACT['backup-share'] = async () => {
  const json = backupJSON();
  try {
    const file = new File([json], backupName(), { type: 'text/plain' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: 'Sauvegarde de la caisse' });
      setMeta({ lastBackupAt: new Date().toISOString() }); toast('Sauvegarde envoyée'); render(); return;
    }
  } catch (e) {
    if (e && e.name === 'AbortError') return;
  }
  ACT['backup-dl']();
};
ACT['restore-pick'] = () => $('#restore-file').click();
async function readRestore(file) {
  let obj;
  try { obj = JSON.parse(await file.text()); } catch (e) { obj = null; }
  if (Sync.linked()) { toast('Quittez d’abord la synchronisation pour restaurer.'); return; }
  if (!obj || obj.app !== 'caisse-manifestation' || !obj.data) { toast('Ce fichier n’est pas une sauvegarde de la caisse.'); return; }
  const n = (obj.data.events || []).length, v = (obj.data.sales || []).length;
  confirmModal({
    title: 'Remplacer les données ?', yesLabel: 'Restaurer', danger: true,
    text: `Sauvegarde du ${esc(fmtDateTime(obj.exportedAt))} : ${n} manifestation${n > 1 ? 's' : ''}, ${v} vente${v > 1 ? 's' : ''}.<br><b>Les données actuelles de cette tablette seront remplacées.</b>`,
    fn: async () => {
      await clearAllStores();
      STORES.forEach(store => (obj.data[store] || []).forEach(o => save(store, o)));
      migrate();
      setMeta({ lastBackupAt: obj.exportedAt });
      ui.cart = []; persistCart(null); toast('Sauvegarde restaurée'); go('#/');
    },
  });
}
ACT.wipe = () => Sync.linked() ? toast('Quittez d’abord la synchronisation.') : confirmModal({
  title: 'Tout effacer ?', yesLabel: 'Tout effacer', danger: true,
  text: 'Produits, bénévoles, manifestations et ventes seront supprimés de cette tablette. Cette action est définitive.',
  fn: async () => { await clearAllStores(); ui.cart = []; persistCart(null); toast('Données effacées'); go('#/'); },
});

/* ========== jeu d'exemple ========== */
function loadSample() {
  const boisson = save('tickets', { id: uid(), name: 'Boisson', shared: true }).id;
  const P = (name, cat, price, ticket) => createProduct({ name, category: cat, price, ticket: ticket || 'own' });
  const items = [
    [P('Bière pression 25 cl', 'Boissons', 250), 120], [P('Vin rouge (verre)', 'Boissons', 200), 60],
    [P('Coca-Cola', 'Boissons sans alcool', 200, boisson), 48], [P('Eau 50 cl', 'Boissons sans alcool', 100, boisson), 60],
    [P('Jus de pomme', 'Boissons sans alcool', 200, boisson), 36], [P('Café', 'Boissons sans alcool', 100, boisson), 80],
    [P('Saucisse frites', 'Restauration', 600), 60], [P('Frites', 'Restauration', 300), 70],
    [P('Crêpe sucre', 'Desserts', 250), 40], [P('Gaufre', 'Desserts', 300), 30],
  ];
  const vols = ['Camille D.', 'Julien M.', 'Sophie L.', 'Marc T.', 'Inès R.', 'Paul B.'].map(name => save('volunteers', { id: uid(), name, active: true }));
  const ev = createEvent({ name: 'Fête du village (exemple)', date: localDate() });
  ev.floatCents = 10000; ev.defaultCredit = 1000; ev.place = 'Salle des fêtes';
  items.forEach(([p, stock]) => { ev.products[p.id] = { price: p.price, stock }; });
  vols.forEach(v => { ev.volunteers[v.id] = { credit: 1000 }; });
  save('events', ev);
  toast('Jeu d’exemple chargé'); go(`#/event/${ev.id}/prep`);
}
ACT.sample = loadSample;

/* ========== écran Plusieurs tablettes ========== */
const AUTH_ERR = {
  'auth/invalid-credential': 'Adresse ou mot de passe incorrect.', 'auth/wrong-password': 'Adresse ou mot de passe incorrect.',
  'auth/user-not-found': 'Adresse ou mot de passe incorrect.', 'auth/invalid-email': 'Adresse e-mail invalide.',
  'auth/network-request-failed': 'Pas de connexion Internet.', 'auth/too-many-requests': 'Trop d’essais. Patientez quelques minutes.',
};
function viewSync() {
  const s = Sync.state(), inf = Sync.info();
  const head = topbar(null) + `<main id="main" class="page" data-keep="main"><h1>Plusieurs tablettes</h1>${storageBanner()}`;
  if (!Sync.enabled()) {
    return head + `<div class="card"><h2>Mode une tablette</h2><p>La synchronisation n’est pas configurée : l’appli fonctionne sur cette tablette uniquement. Pour utiliser plusieurs tablettes, suivez le guide <b>GUIDE-FIREBASE.md</b> (création d’un projet Firebase gratuit), puis renseignez le fichier <b>firebase-config.js</b> sur GitHub.</p></div></main>`;
  }
  if (s.error && !Sync.hasAdapter()) {
    return head + `<div class="card"><h2>Synchronisation indisponible</h2><p>${esc(s.error)}</p><button class="btn primary" data-act="sync-retry">Réessayer</button></div></main>`;
  }
  if (!Sync.hasAdapter() || !s.authKnown) return head + '<div class="card"><p>Chargement…</p></div></main>';
  if (!s.user) {
    return head + `<div class="card"><h2>Connexion au compte partagé</h2>${s.linked
      ? '<p>Cette tablette est liée mais n’est plus connectée. Les ventes continuent d’être enregistrées ici et partiront dès la reconnexion.</p>'
      : '<p>Utilisez l’adresse et le mot de passe du compte créé dans Firebase (voir le guide). Ils ne sont à saisir qu’une fois par tablette.</p>'}
      <form data-form="sync-signin"><div class="formgrid">
        <label>Adresse e-mail<input name="email" type="email" required autocomplete="username" value="${esc(ui.syncEmail || (window.SYNC_CONFIG && window.SYNC_CONFIG.email) || '')}"></label>
        <label>Mot de passe<input name="password" type="password" required autocomplete="current-password"></label></div>
        ${ui.syncError ? `<p class="neg" role="alert">${esc(ui.syncError)}</p>` : ''}
        <div class="modal-actions"><button class="btn primary">Se connecter</button></div></form>
      ${s.linked ? '<div class="row"><button class="btn ghost" data-act="sync-out">Quitter la synchronisation</button></div>' : ''}</div></main>`;
  }
  if (!s.linked) {
    const sit = inf.situation, c = sit && sit.counts;
    let body;
    if (inf.probeError) body = `<p class="neg">${esc(inf.probeError)}</p><button class="btn" data-act="sync-retry-probe">Réessayer</button>`;
    else if (inf.probing || !sit) body = '<p>Vérification du cloud…</p>';
    else if (sit.remoteEmpty && sit.localEmpty) body = '<p>Le cloud est vide. Activez la synchronisation puis saisissez vos produits.</p><button class="btn primary big" data-act="sync-link" data-mode="join">Activer la synchronisation</button>';
    else if (sit.remoteEmpty) body = `<p>Le cloud est vide et cette tablette contient des données : ${c.events} manifestation${c.events > 1 ? 's' : ''}, ${c.products} produit${c.products > 1 ? 's' : ''}, ${c.volunteers} bénévole${c.volunteers > 1 ? 's' : ''}, ${c.sales} vente${c.sales > 1 ? 's' : ''}.</p><button class="btn primary big" data-act="sync-link" data-mode="upload">Envoyer mes données vers le cloud</button>`;
    else if (sit.localEmpty) body = '<p>Le cloud contient déjà des données. Cette tablette va les récupérer.</p><button class="btn primary big" data-act="sync-link" data-mode="join">Rejoindre la synchronisation</button>';
    else body = '<div class="banner warn"><div class="grow"><b>Cette tablette et le cloud contiennent chacun des données.</b> Elles ne peuvent pas être fusionnées : celles de la tablette seront remplacées par celles du cloud. Faites d’abord une sauvegarde si vous voulez les conserver.</div><a class="btn" href="#/backup">Sauvegarder</a></div><button class="btn danger big" data-act="sync-link" data-mode="replace">Remplacer les données de cette tablette</button>';
    return head + `<div class="card"><h2>Relier cette tablette</h2><p class="muted">Connecté avec ${esc(s.user.email || 'le compte partagé')}.</p>
      <label>Nom de cette tablette<input id="tabname" value="${esc(ui.syncTablet || '')}" placeholder="Caisse 1" autocomplete="off"></label>
      <div style="margin-top:1rem">${body}</div></div>
      <div class="card"><button class="btn ghost" data-act="sync-signout">Se déconnecter</button></div></main>`;
  }
  const p = Sync.pillInfo();
  return head + `<div class="card"><div class="row sb"><h2 style="margin:0">Synchronisation active</h2><span class="syncpill ${p.cls}">${esc(p.text)}</span></div>
    <p class="muted">Compte : ${esc(s.user.email || '')}</p>
    <form class="row" data-form="sync-tablet"><label class="grow">Nom de cette tablette<input name="name" value="${esc(Sync.tabletName())}" required autocomplete="off"></label><button class="btn" style="align-self:flex-end">Enregistrer</button></form>
    <p>${s.pending ? `${s.pending} modification${s.pending > 1 ? 's' : ''} en attente d’envoi.` : 'Tout est envoyé.'} Le nom de la tablette est enregistré avec chaque vente, pour le bilan.</p></div>
    ${(() => { const d = Sync.diag(); const hm = t => new Date(t).toLocaleTimeString('fr-FR');
      return `<div class="card"><h2>Diagnostic</h2><ul><li>Dernier échange avec le serveur : ${d.lastContact ? hm(d.lastContact) : 'aucun depuis le démarrage'}</li>
      <li>Dernière erreur d’envoi : ${esc(d.lastErr || 'aucune')}</li>${d.pending.length ? `<li>En attente : ${d.pending.length} élément(s) (${esc(d.pending.slice(0, 6).join(', '))})</li>` : ''}</ul>
      ${d.testResult ? `<p><strong>${esc(d.testResult)}</strong></p>` : ''}
      <div class="row"><button class="btn" data-act="sync-test">Tester l’écriture</button><button class="btn" data-act="sync-reconnect">Relancer la liaison</button></div></div>`; })()}
    <div class="card"><h2>À savoir</h2><ul><li>Une seule tablette règle une ardoise ou clôture la manifestation.</li><li>Si une tablette perd le réseau, elle continue d’encaisser : ses ventes partent au retour de la connexion.</li><li>Faites tout de même une sauvegarde à la fin de chaque manifestation.</li></ul></div>
    <div class="card"><button class="btn ghost" data-act="sync-out">Quitter la synchronisation</button><p class="muted">La tablette garde ses données mais ne communique plus avec les autres.</p></div></main>`;
}
FORM['sync-signin'] = async (f, fd) => {
  ui.syncEmail = (fd.get('email') || '').trim(); ui.syncError = '';
  try { await Sync.signIn(ui.syncEmail, fd.get('password')); } catch (e) {
    ui.syncError = AUTH_ERR[e && e.code] || 'Connexion impossible (' + ((e && (e.code || e.message)) || 'erreur') + ').';
  }
  render();
};
FORM['sync-tablet'] = (f, fd) => { Sync.setTablet(fd.get('name')); toast('Nom enregistré'); render(); };
ACT['sync-link'] = async el => {
  const name = (($('#tabname') || {}).value || '').trim(), mode = el.dataset.mode;
  if (!name) { toast('Donnez un nom à cette tablette (par exemple Caisse 1).'); return; }
  ui.syncTablet = name;
  const run = async () => {
    try { await Sync.link(mode, name); toast('Synchronisation activée'); } catch (e) { console.error(e); toast('Échec : ' + ((e && e.message) || 'erreur')); }
    render();
  };
  if (mode === 'replace') confirmModal({ title: 'Remplacer les données ?', text: 'Les données de cette tablette seront supprimées et remplacées par celles du cloud.', yesLabel: 'Remplacer', danger: true, fn: run });
  else await run();
};
ACT['sync-out'] = () => confirmModal({
  title: 'Quitter la synchronisation ?', yesLabel: 'Quitter', danger: true,
  text: 'Cette tablette garde ses données mais ne communique plus avec les autres. Pour la relier de nouveau, elle devra récupérer les données du cloud et remplacera ses données locales.',
  fn: async () => { await Sync.unlink(); render(); },
});
ACT['sync-signout'] = async () => { try { await Sync.signOut(); } catch (e) { /* ignoré */ } render(); };
ACT['sync-retry'] = () => { Sync.retry(); render(); };
ACT['pick-cat'] = el => {
  const f = el.closest('form'), inp = f && f.querySelector('input[name=category]');
  if (!inp) return;
  inp.value = el.dataset.v;
  f.querySelectorAll('.catpick .chip').forEach(c => c.classList.toggle('on', c === el));
};
ACT['vol-all'] = () => {
  const ev = curEvent();
  list('volunteers').filter(v => v.active).forEach(v => { if (!ev.volunteers[v.id]) ev.volunteers[v.id] = { credit: ev.defaultCredit || 0 }; });
  save('events', ev); render();
};
ACT['vol-none'] = () => {
  const ev = curEvent(); let kept = 0;
  Object.keys(ev.volunteers).forEach(id => { if (tabOf(ev, id).consumed > 0) kept++; else delete ev.volunteers[id]; });
  save('events', ev); render();
  if (kept) toast(kept + ' bénévole' + (kept > 1 ? 's' : '') + ' gardé' + (kept > 1 ? 's' : '') + ' : consommation déjà enregistrée.');
};
ACT['sync-test'] = () => { Sync.test(); };
ACT['sync-reconnect'] = () => { Sync.reconnect(); };
ACT['sync-retry-probe'] = () => { Sync.probe(); };
document.addEventListener('input', e => { if (e.target.id === 'tabname') ui.syncTablet = e.target.value; });

/* ========== événements globaux ========== */
document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (!el || el.disabled) return;
  const fn = ACT[el.dataset.act];
  if (fn) fn(el, e);
});
document.addEventListener('submit', e => {
  const f = e.target.closest('form[data-form]');
  if (!f) return;
  e.preventDefault();
  const fn = FORM[f.dataset.form];
  if (fn) fn(f, new FormData(f));
});
document.addEventListener('change', e => {
  if (e.target.id === 'restore-file') { const f = e.target.files[0]; e.target.value = ''; if (f) readRestore(f); return; }
  const fn = CHG[e.target.dataset.chg];
  if (fn) fn(e.target);
});
document.addEventListener('input', e => {
  if (e.target.id === 'vsearch') {
    const q = e.target.value.trim().toLowerCase();
    document.querySelectorAll('.vol-btn').forEach(b => { b.hidden = q && !b.dataset.name.includes(q); });
  } else if (e.target.id === 'counted') updateEcart();
});
document.addEventListener('keydown', e => {
  if (e.key !== 'Enter' || !e.target.dataset || !e.target.dataset.nav) return;
  e.preventDefault();
  const all = [...document.querySelectorAll(`[data-nav="${e.target.dataset.nav}"]:not(:disabled)`)];
  const nxt = all[all.indexOf(e.target) + 1];
  if (nxt) { nxt.focus(); nxt.select && nxt.select(); } else e.target.blur();
});
window.addEventListener('hashchange', () => { ui.modal = null; ui.pay = null; ui.settle = null; render(); });

/* ========== démarrage ========== */
(async function boot() {
  try { db = await openDB(); await loadAll(); } catch (e) { console.error(e); db = null; dbOk = false; }
  migrate();
  restoreCart();
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  render();
  Sync.init();
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('sw.js').catch(err => console.warn('Service worker indisponible', err));
  }
})();
