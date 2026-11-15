// Règles métier : facture, circuit des statuts, scan, bilan. Toutes les règles sont ici.
import { db } from './db.js';
import { SEED } from './seed.js';

export const STATUS = { RECU: 0, COUSIN: 1, A_REPASSER: 2, REPASSE: 3, PRET: 4, LIVRE: 5 };
export const STATUS_LABEL = ['Reçu', 'Chez le cousin', 'À repasser', 'Repassé', 'Prêt', 'Livré'];
// orange = à traiter, bleu = en cours, vert = terminé
export const STATUS_TONE = ['orange', 'blue', 'orange', 'orange', 'green', 'done'];

export const EXPENSE_CATEGORIES = [
  { key: 'salaires', label: 'Salaires', invest: false },
  { key: 'loyer', label: 'Loyer', invest: false },
  { key: 'energie', label: 'Électricité et eau', invest: false },
  { key: 'transport', label: 'Transport et carburant', invest: false },
  { key: 'fournitures', label: 'Produits et fournitures', invest: false },
  { key: 'communication', label: 'Téléphone et internet', invest: false },
  { key: 'entretien', label: 'Entretien et réparations', invest: false },
  { key: 'taxes', label: 'Taxes et impôts', invest: false },
  { key: 'dedommagement', label: 'Dédommagements clients', invest: false },
  { key: 'autres', label: 'Autres dépenses', invest: false },
  { key: 'investissement', label: 'Investissement (machine, fer…)', invest: true },
];
export const catLabel = (k) => (EXPENSE_CATEGORIES.find((c) => c.key === k) || { label: k }).label;
export const catInvest = (k) => !!(EXPENSE_CATEGORIES.find((c) => c.key === k) || {}).invest;

const DEFAULT_SETTINGS = {
  name: 'MonPressing', city: '', phone: '', logo: '',
  cousinRate: 400, deliveryFee: 500, savingsPercent: 25, invoiceStart: 1, adminPin: '',
  dueDays: 2, loyaltyEvery: 10, loyaltyType: 'percent', loyaltyValue: 20, monthlyReport: true,
  volumeMin: 5000, volumePercent: 10, waApp: 'business', waBusinessPhone: '0161084250',
  remindOn: true, remindAfter: 7, remindEvery: 7, remindMax: 3, remindHour: 10,
};

// ---------- formatage ----------
export const pad = (n, w = 2) => String(n).padStart(w, '0');
export const orderCode = (number) => 'PR' + pad(number, 4);
export const pieceCode = (number, index) => orderCode(number) + '-' + pad(index);
export const money = (n) => Math.round(n || 0).toLocaleString('fr-FR').replace(/ | /g, ' ') + ' F';
export const kg = (n) => (Math.round((n || 0) * 100) / 100).toLocaleString('fr-FR') + ' kg';
export function nowIso() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
export const todayIso = () => nowIso().slice(0, 10);
export function fmtDate(iso, withTime = true) {
  if (!iso) return '';
  const [d, t] = iso.split('T');
  const [y, m, j] = d.split('-');
  return `${j}/${m}/${y}` + (withTime && t ? ' ' + t.slice(0, 5) : '');
}
export function fmtShort(iso) {
  if (!iso) return '';
  const [d, t] = iso.split('T');
  const [, m, j] = d.split('-');
  return `${j}/${m}` + (t ? ' à ' + t.slice(0, 5) : '');
}

// ---------- réglages ----------
export async function getSettings() {
  return { ...DEFAULT_SETTINGS, ...((await db.kv('settings')) || {}) };
}
export async function saveSettings(s) { await db.kv('settings', s); }

export async function isInitialized() { return !!(await db.kv('initialized')); }

export async function initialize(withHistory) {
  await db.kv('settings', { ...DEFAULT_SETTINGS, ...SEED.settings });
  for (const a of SEED.articles) await db.put('articles', { ...a });
  if (withHistory) {
    for (const o of SEED.orders) await db.put('orders', { cousinRate: SEED.settings.cousinRate, ...o });
  }
  await db.kv('initialized', nowIso());
  if (navigator.storage && navigator.storage.persist) { try { await navigator.storage.persist(); } catch (e) {} }
}

export async function getArticles(activeOnly = false) {
  const list = (await db.all('articles')).sort((a, b) => a.position - b.position || a.id - b.id);
  return activeOnly ? list.filter((a) => a.active) : list;
}

// ---------- calculs d'une commande ----------
export function orderTotals(o) {
  const items = o.items.reduce((s, i) => s + i.qty * i.price, 0);
  const estKg = o.items.reduce((s, i) => s + (i.homeWash ? 0 : i.qty * i.weight), 0);
  const washKg = o.weighedKg != null && o.weighedKg !== '' ? Number(o.weighedKg) : estKg;
  const wash = Math.round(washKg * (o.cousinRate || 0));
  const discount = Math.min(items + (o.deliveryFee || 0), Math.round((o.discount && o.discount.amount) || 0));
  const sales = items + (o.deliveryFee || 0) - discount;          // vente de cette facture (chiffre d'affaires)
  const arrears = Math.max(0, Math.round((o.arrears && o.arrears.amount) || 0)); // ancien solde reporté (hors CA)
  const total = sales + arrears;                                  // ce que le client doit payer
  const paid = paidAmount(o, total);
  const transferred = (o.transfers || []).reduce((a, x) => a + (Number(x.amount) || 0), 0);
  return { items, discount, sales, arrears, total, estKg, washKg, wash, margin: sales - wash, pieces: o.pieces.length, paid, transferred, due: Math.max(0, total - paid - transferred) };
}

// ---------- paiements (acomptes, paiements partiels) ----------
// Anciennes factures : pas de liste de paiements, seulement « paid » (tout ou rien).
export function paidAmount(o, total) {
  if (Array.isArray(o.payments)) return o.payments.reduce((s, p) => s + (Number(p.amount) || 0), 0);
  if (total === undefined) {
    const items = o.items.reduce((s, i) => s + i.qty * i.price, 0);
    total = items + (o.deliveryFee || 0) - Math.round((o.discount && o.discount.amount) || 0);
  }
  return o.paid ? total : 0;
}
function ensurePayments(o) {
  if (!Array.isArray(o.payments)) {
    const t = orderTotals({ ...o, payments: [] }).total;
    o.payments = o.paid ? [{ amount: t, at: o.createdAt, note: 'Paiement' }] : [];
  }
}
export function syncPaid(o) {
  const t = orderTotals(o);
  o.paid = t.total > 0 ? t.due <= 0 : true;
}
export async function addPayment(o, amount, note = '') {
  amount = Math.round(Number(amount) || 0);
  if (amount <= 0) throw new Error('Montant invalide.');
  ensurePayments(o);
  o.payments.push({ amount, at: nowIso(), note });
  syncPaid(o);
  o.events.push({ status: o.status, note: `Paiement reçu : ${money(amount)}`, at: nowIso() });
  await saveOrder(o);
}
export async function clearPayments(o) {
  o.payments = [];
  syncPaid(o);
  o.events.push({ status: o.status, note: 'Paiements annulés (marqué impayé)', at: nowIso() });
  await saveOrder(o);
}

// ---------- délais ----------
export const dueDate = (o) => o.dueAt || o.deliveryAt || null;
// 'late' : date promise dépassée et pas encore prêt ; 'soon' : à rendre dans les 24 h.
export function lateness(o) {
  const d = dueDate(o);
  if (!d || o.status >= STATUS.PRET) return null;
  const now = nowIso().slice(0, 16);
  if (d.slice(0, 16) < now) return 'late';
  const t = new Date(Date.now() + 24 * 3600e3);
  const lim = `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}T${pad(t.getHours())}:${pad(t.getMinutes())}`;
  return d.slice(0, 16) <= lim ? 'soon' : null;
}
export function defaultDue(days) {
  const t = new Date(Date.now() + (Number(days) || 0) * 864e5);
  return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}T17:00`;
}

// ---------- clients ----------
export function phoneKey(p) { const d = String(p || '').replace(/\D/g, ''); return d.length >= 8 ? d.slice(-8) : ''; }
export function clientKey(o) { return phoneKey(o.clientPhone) ? 'tel:' + phoneKey(o.clientPhone) : 'nom:' + o.clientName.trim().toLowerCase(); }
export function listClients(orders) {
  const map = new Map();
  for (const o of orders.slice().sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
    const k = clientKey(o);
    const c = map.get(k) || { key: k, name: o.clientName, phone: o.clientPhone || '', orders: [], spent: 0, due: 0, pieces: 0, firstAt: o.createdAt, lastAt: o.createdAt };
    const t = orderTotals(o);
    c.orders.push(o); c.spent += t.sales; c.due += t.due; c.pieces += t.pieces;
    if (o.clientName.trim().length >= c.name.trim().length) c.name = o.clientName; if (o.clientPhone) c.phone = o.clientPhone; c.lastAt = o.createdAt;
    map.set(k, c);
  }
  return [...map.values()];
}
export async function findClients(text) {
  const t = String(text || '').trim().toLowerCase();
  if (t.length < 2) return [];
  const digits = t.replace(/\D/g, '');
  return listClients(await db.all('orders'))
    .filter((c) => c.name.toLowerCase().includes(t) || (digits.length >= 3 && c.phone.replace(/\D/g, '').includes(digits)))
    .sort((a, b) => b.lastAt.localeCompare(a.lastAt)).slice(0, 5);
}

// ---------- fidélité ----------
// Toutes les N commandes, la N-ième a droit à la récompense. previousCount = commandes déjà faites.
export function loyaltyReward(s, previousCount, subtotal) {
  const every = Number(s.loyaltyEvery) || 0;
  if (every < 2 || (previousCount + 1) % every !== 0) return null;
  const v = Number(s.loyaltyValue) || 0;
  if (v <= 0) return null;
  const amount = s.loyaltyType === 'amount' ? Math.min(v, subtotal) : Math.round(subtotal * Math.min(100, v) / 100);
  const label = `Fidélité : ${previousCount + 1}e commande (${s.loyaltyType === 'amount' ? money(v) : v + ' %'})`;
  return { amount, label };
}
// Remise sur grosse commande : X % dès que les articles atteignent le seuil (livraison non comprise).
export function volumeReward(s, subtotal) {
  const min = Number(s.volumeMin) || 0, pct = Number(s.volumePercent) || 0;
  if (min <= 0 || pct <= 0 || subtotal < min) return null;
  return { amount: Math.round(subtotal * Math.min(100, pct) / 100), label: `Remise ${pct} % (dès ${money(min)})` };
}
export function loyaltyProgress(s, count) {
  const every = Number(s.loyaltyEvery) || 0;
  if (every < 2) return null;
  const inCycle = count % every;
  return { every, done: inCycle, left: every - 1 - inCycle };
}

// ---------- cousin ----------
export function cousinSummary(orders, payments) {
  const sent = orders.filter((o) => o.status >= STATUS.COUSIN && cousinPieces(o).length)
    .map((o) => ({ o, kg: orderTotals(o).washKg, amount: orderTotals(o).wash, at: (o.events.find((e) => e.status === STATUS.COUSIN) || {}).at || o.createdAt }))
    .sort((a, b) => b.at.localeCompare(a.at));
  const owed = sent.reduce((s, r) => s + r.amount, 0);
  const kgTotal = sent.reduce((s, r) => s + r.kg, 0);
  const paid = (payments || []).reduce((s, p) => s + (Number(p.amount) || 0), 0);
  return { sent, owed, kg: kgTotal, paid, left: owed - paid };
}
export async function getCousinPayments() { return (await db.kv('cousinPayments')) || []; }
export async function addCousinPayment(amount, note, date) {
  amount = Math.round(Number(amount) || 0);
  if (amount <= 0) throw new Error('Montant invalide.');
  const list = await getCousinPayments();
  list.push({ id: Date.now(), date: date || todayIso(), amount, note: note || '' });
  await db.kv('cousinPayments', list);
}
export async function deleteCousinPayment(id) {
  await db.kv('cousinPayments', (await getCousinPayments()).filter((p) => p.id !== id));
}

// ---------- réclamations ----------
export const CLAIM_TYPES = { abimee: 'Pièce abîmée', perdue: 'Pièce perdue', tache: 'Tache restée', retard: 'Retard', autre: 'Autre' };
export async function addClaim(o, { type, pieceIndex, note }) {
  o.claims = o.claims || [];
  o.claims.push({ id: Date.now(), type, pieceIndex: pieceIndex || null, note: (note || '').trim(), status: 'open', createdAt: nowIso() });
  o.events.push({ status: o.status, note: 'Réclamation : ' + (CLAIM_TYPES[type] || type), at: nowIso() });
  await saveOrder(o);
}
export async function resolveClaim(o, id, { resolution, compensation }) {
  const c = (o.claims || []).find((x) => x.id === id);
  if (!c) return;
  c.status = 'resolved'; c.resolvedAt = nowIso(); c.resolution = (resolution || '').trim();
  c.compensation = Math.round(Number(compensation) || 0);
  o.events.push({ status: o.status, note: 'Réclamation réglée' + (c.compensation ? ` (dédommagement ${money(c.compensation)})` : ''), at: nowIso() });
  await saveOrder(o);
  if (c.compensation > 0) {
    await db.put('expenses', { date: todayIso(), amount: c.compensation, category: 'dedommagement', label: `N°${o.number} ${o.clientName} : ${CLAIM_TYPES[c.type] || ''}`, createdAt: nowIso() });
  }
}
export async function openClaims() {
  const out = [];
  for (const o of await db.all('orders')) for (const c of o.claims || []) if (c.status === 'open') out.push({ o, c });
  return out.sort((a, b) => a.c.createdAt.localeCompare(b.c.createdAt));
}

export function itemsSummary(o) {
  return o.items.map((i) => `${i.qty} ${i.name}`).join(', ');
}

// ---------- création de facture ----------
export async function nextNumber() {
  const s = await getSettings();
  const keys = await db.keys('orders');
  const max = keys.length ? Math.max(...keys) : 0;
  return Math.max(max + 1, Number(s.invoiceStart) || 1);
}

export async function createOrder({ clientId, clientSex, clientName, clientPhone, quantities, prices = {}, weighedKg, delivery, deliveryPlace, deliveryAt, dueAt, discount, deposit, arrears, homeOnly }) {
  const s = await getSettings();
  const arts = await getArticles();
  const items = [];
  for (const a of arts) {
    const q = quantities[a.id] || 0;
    const price = prices[a.id] != null && prices[a.id] !== '' ? Math.max(0, Math.round(Number(prices[a.id]))) : a.price;
    if (q > 0) items.push({ name: a.name, qty: q, price, ...(price !== a.price ? { listPrice: a.price } : {}), weight: a.weight, homeWash: !!(a.homeWash || homeOnly) });
  }
  if (!clientName.trim()) throw new Error('Indiquez le nom du client.');
  if (!items.length && !(arrears && arrears.amount > 0)) throw new Error('Ajoutez au moins un article.');
  const pieces = [];
  let idx = 1;
  for (const it of items) for (let k = 0; k < it.qty; k++) pieces.push({ index: idx++, name: it.name, homeWash: it.homeWash, checks: {} });
  const number = await nextNumber();
  const order = {
    number, clientId: clientId || null, clientSex: clientSex || '', clientName: clientName.trim(), clientPhone: (clientPhone || '').trim(),
    status: STATUS.RECU, createdAt: nowIso(),
    weighedKg: weighedKg === '' || weighedKg == null ? null : Number(weighedKg),
    deliveryFee: delivery ? Number(s.deliveryFee) || 0 : 0,
    deliveryPlace: delivery ? (deliveryPlace || '').trim() : '',
    deliveryAt: delivery && deliveryAt ? deliveryAt : null,
    cousinRate: Number(s.cousinRate) || 0,
    dueAt: dueAt || (delivery && deliveryAt ? deliveryAt : null),
    discount: discount && discount.amount > 0 ? { amount: Math.round(discount.amount), label: discount.label || 'Remise' } : null,
    arrears: arrears && Number(arrears.amount) > 0 ? { amount: Math.round(Number(arrears.amount)), note: (arrears.note || '').trim() } : null,
    washMode: homeOnly ? 'maison' : 'cousin',
    paid: false, note: '', items, pieces, payments: [], claims: [],
    events: [{ status: STATUS.RECU, note: 'Facture émise', at: nowIso() }],
  };
  const dep = Math.round(Number(deposit) || 0);
  if (dep > 0) {
    const tot = orderTotals(order).total;
    order.payments.push({ amount: Math.min(dep, tot), at: nowIso(), note: dep >= tot ? 'Payé à la remise' : 'Acompte' });
    syncPaid(order);
  }
  await db.put('orders', order);
  return order;
}

export const getOrder = (n) => db.get('orders', Number(n));
export async function allOrders() {
  return (await db.all('orders')).sort((a, b) => b.number - a.number);
}
export async function saveOrder(o) { await db.put('orders', o); }
export async function deleteOrder(o) {
  for (const p of o.pieces) await db.del('photos', pieceCode(o.number, p.index));
  await db.del('orders', o.number);
}

// ---------- circuit ----------
export const cousinPieces = (o) => o.pieces.filter((p) => !p.homeWash);

// Action principale proposée selon l'étape.
export function nextAction(o) {
  switch (o.status) {
    case STATUS.RECU:
      return cousinPieces(o).length
        ? { label: 'Envoyer au cousin', kind: 'advance', to: STATUS.COUSIN }
        : { label: 'Lavage maison fait', kind: 'advance', to: STATUS.A_REPASSER };
    case STATUS.COUSIN: return { label: 'Retour du cousin : vérifier', kind: 'verify', stage: 'cousin' };
    case STATUS.A_REPASSER: return { label: 'Repassage terminé', kind: 'advance', to: STATUS.REPASSE };
    case STATUS.REPASSE: return { label: 'Vérification finale', kind: 'verify', stage: 'final' };
    case STATUS.PRET: return { label: 'Livré / remis', kind: 'deliver' };
    default: return null;
  }
}

export async function advance(o, to, note = '') {
  const allowed = {
    [STATUS.RECU]: [STATUS.COUSIN, ...(cousinPieces(o).length ? [] : [STATUS.A_REPASSER])],
    [STATUS.COUSIN]: [STATUS.A_REPASSER],
    [STATUS.A_REPASSER]: [STATUS.REPASSE],
    [STATUS.REPASSE]: [STATUS.PRET],
    [STATUS.PRET]: [STATUS.LIVRE],
  }[o.status] || [];
  if (!allowed.includes(to)) throw new Error('Étape non autorisée.');
  if (to === STATUS.A_REPASSER && o.status === STATUS.COUSIN && !stageComplete(o, 'cousin')) throw new Error('Toutes les pièces ne sont pas scannées.');
  if (to === STATUS.PRET && !stageComplete(o, 'final')) throw new Error('Toutes les pièces ne sont pas scannées.');
  o.status = to;
  o.events.push({ status: to, note, at: nowIso() });
  await saveOrder(o);
  return o;
}

export function stagePieces(o, stage) {
  return stage === 'cousin' ? cousinPieces(o) : o.pieces;
}
export function stageComplete(o, stage) {
  return stagePieces(o, stage).every((p) => p.checks && p.checks[stage]);
}

const CODE_RE = /^PR(\d{3,})(?:-(\d{1,3}))?$/;
export function parseCode(raw) {
  const code = String(raw || '').trim().toUpperCase().replace(/\s+/g, '');
  const m = code.match(CODE_RE);
  if (!m) return null;
  return { number: Number(m[1]), index: m[2] ? Number(m[2]) : null, code };
}

// Scan d'une étiquette pendant une vérification. Renvoie { ok, message, piece }.
export async function scanPiece(o, stage, raw) {
  const c = parseCode(raw);
  if (!c) return { ok: false, message: 'Code non reconnu.' };
  if (c.number !== o.number) return { ok: false, message: `Cette pièce est de la commande N°${c.number}, pas de la N°${o.number}.` };
  if (c.index == null) return { ok: false, message: 'C’est le code de la facture : scannez l’étiquette d’une pièce.' };
  const p = o.pieces.find((x) => x.index === c.index);
  if (!p) return { ok: false, message: `La pièce ${c.code} n’existe pas dans cette commande.` };
  if (stage === 'cousin' && p.homeWash) return { ok: false, message: `${p.name} (${c.code}) : lavage maison, pas besoin de la scanner ici.` };
  p.checks = p.checks || {};
  if (p.checks[stage]) return { ok: false, message: `${c.code} est déjà scannée.` };
  p.checks[stage] = nowIso();
  await saveOrder(o);
  return { ok: true, message: `${p.name} ${c.code} vérifiée`, piece: p };
}

// Coche / décoche une pièce pendant une vérification. Renvoie true si elle est cochée.
export async function togglePiece(o, stage, index) {
  const p = stagePieces(o, stage).find((x) => x.index === index);
  if (!p) return false;
  p.checks = p.checks || {};
  if (p.checks[stage]) delete p.checks[stage]; else p.checks[stage] = nowIso();
  await saveOrder(o);
  return !!p.checks[stage];
}

export async function reportGap(o, note) {
  note = (note || '').trim();
  if (!note) return;
  o.note = o.note ? o.note + ' · ' + note : note;
  o.events.push({ status: o.status, note: 'Écart : ' + note, at: nowIso() });
  await saveOrder(o);
}

export async function findPiece(raw) {
  const c = parseCode(raw);
  if (!c) return null;
  const o = await getOrder(c.number);
  if (!o) return { code: c.code, missing: true };
  const p = c.index != null ? o.pieces.find((x) => x.index === c.index) : null;
  return { code: c.code, order: o, piece: p };
}

// ---------- photos ----------
export const getPhoto = (code) => db.get('photos', code);
export const savePhoto = (code, dataUrl) => db.put('photos', dataUrl, code);

export function resizeImage(file, max = 900, quality = 0.75) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const r = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * r); c.height = Math.round(img.height * r);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Image illisible')); };
    img.src = url;
  });
}

// ---------- compteurs d'accueil ----------
export async function counts() {
  const orders = await db.all('orders');
  const c = { byStatus: [0, 0, 0, 0, 0, 0], open: 0, todayCount: 0, todayCA: 0, unpaid: 0, late: [], soon: [], claims: 0 };
  const today = todayIso();
  for (const o of orders) {
    c.byStatus[o.status]++;
    if (o.status !== STATUS.LIVRE) c.open++;
    if (o.createdAt.slice(0, 10) === today) { c.todayCount++; c.todayCA += orderTotals(o).sales; }
    const l = lateness(o);
    if (l === 'late') c.late.push(o); else if (l === 'soon') c.soon.push(o);
    c.claims += (o.claims || []).filter((x) => x.status === 'open').length;
  }
  return c;
}

// ---------- périodes et bilan ----------
function ymd(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
export const monthName = (m) => MONTHS[m];
const MONTHS_SHORT = ['janv', 'févr', 'mars', 'avr', 'mai', 'juin', 'juil', 'août', 'sept', 'oct', 'nov', 'déc'];
export const monthShort = (m) => MONTHS_SHORT[m];

// kind: week | month | year ; offset: 0 = période en cours, -1 = précédente…
export function period(kind, offset = 0) {
  const now = new Date();
  let start, end, label;
  if (kind === 'week') {
    const day = (now.getDay() + 6) % 7; // lundi = 0
    start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - day + offset * 7);
    end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6);
    label = `Semaine du ${pad(start.getDate())}/${pad(start.getMonth() + 1)} au ${pad(end.getDate())}/${pad(end.getMonth() + 1)}`;
  } else if (kind === 'half') {
    start = new Date(now.getFullYear(), now.getMonth() - 5 + offset * 6, 1);
    end = new Date(start.getFullYear(), start.getMonth() + 6, 0);
    const cap = (m) => MONTHS[m][0].toUpperCase() + MONTHS[m].slice(1);
    label = start.getFullYear() === end.getFullYear()
      ? `${cap(start.getMonth())} – ${cap(end.getMonth())} ${end.getFullYear()}`
      : `${cap(start.getMonth())} ${start.getFullYear()} – ${cap(end.getMonth())} ${end.getFullYear()}`;
  } else if (kind === 'month') {
    start = new Date(now.getFullYear(), now.getMonth() + offset, 1);
    end = new Date(start.getFullYear(), start.getMonth() + 1, 0);
    label = MONTHS[start.getMonth()][0].toUpperCase() + MONTHS[start.getMonth()].slice(1) + ' ' + start.getFullYear();
  } else {
    start = new Date(now.getFullYear() + offset, 0, 1);
    end = new Date(start.getFullYear(), 11, 31);
    label = 'Année ' + start.getFullYear();
  }
  return { kind, offset, start: ymd(start), end: ymd(end), label };
}

export function monthsBetween(startIso, endIso) {
  const out = [];
  let [y, m] = startIso.split('-').map(Number);
  while (`${y}-${pad(m)}` <= endIso.slice(0, 7)) { out.push(`${y}-${pad(m)}`); m++; if (m > 12) { m = 1; y++; } }
  return out;
}

export function daysBetween(startIso, endIso) {
  const out = [];
  const [y, m, d] = startIso.split('-').map(Number);
  const cur = new Date(y, m - 1, d);
  while (ymd(cur) <= endIso) { out.push(ymd(cur)); cur.setDate(cur.getDate() + 1); }
  return out;
}

export function computeBilan(orders, expenses, p, settings) {
  const inP = (iso) => iso.slice(0, 10) >= p.start && iso.slice(0, 10) <= p.end;
  const os = orders.filter((o) => inP(o.createdAt));
  const es = expenses.filter((e) => e.date >= p.start && e.date <= p.end);
  const r = { orders: os.length, ca: 0, cashed: 0, unpaid: 0, washKg: 0, wash: 0, current: 0, invest: 0, articles: {}, byDay: {}, byMonth: {} };
  for (const o of os) {
    const t = orderTotals(o);
    r.ca += t.sales; r.washKg += t.washKg; r.wash += t.wash; r.arrears = (r.arrears || 0) + t.arrears;
    r.cashed += Math.min(t.paid, t.total); r.unpaid += t.due;
    for (const i of o.items) r.articles[i.name] = (r.articles[i.name] || 0) + i.qty;
    const day = o.createdAt.slice(0, 10), mon = o.createdAt.slice(0, 7);
    r.byDay[day] = (r.byDay[day] || 0) + t.sales;
    const bm = (r.byMonth[mon] = r.byMonth[mon] || { ca: 0, wash: 0, exp: 0, inv: 0 });
    bm.ca += t.sales; bm.wash += t.wash;
  }
  const expByCat = {};
  for (const e of es) {
    if (catInvest(e.category)) r.invest += e.amount; else r.current += e.amount;
    expByCat[e.category] = (expByCat[e.category] || 0) + e.amount;
    const mon = e.date.slice(0, 7);
    const bm = (r.byMonth[mon] = r.byMonth[mon] || { ca: 0, wash: 0, exp: 0, inv: 0 });
    if (catInvest(e.category)) bm.inv += e.amount; else bm.exp += e.amount;
  }
  r.expByCat = expByCat;
  r.orderList = os.sort((a, b) => a.number - b.number);
  r.expenseList = es.sort((a, b) => a.date.localeCompare(b.date));
  r.margin = r.ca - r.wash;
  r.washRatio = r.ca ? r.wash / r.ca : 0;
  r.net = r.margin - r.current;
  r.netAfterInvest = r.net - r.invest;
  r.savings = Math.max(0, Math.round(r.margin * (Number(settings.savingsPercent) || 0) / 100));
  r.topArticles = Object.entries(r.articles).sort((a, b) => b[1] - a[1]).slice(0, 6);
  return r;
}

// ---------- dépenses ----------
export async function allExpenses() {
  return (await db.all('expenses')).sort((a, b) => (b.date + b.id).localeCompare(a.date + a.id));
}

// ---------- sauvegarde complète ----------
export async function exportAll() {
  const photos = {};
  for (const k of await db.keys('photos')) photos[k] = await db.get('photos', k);
  return {
    app: 'monpressing', version: 1, exportedAt: nowIso(),
    settings: await db.kv('settings'), articles: await db.all('articles'),
    orders: await db.all('orders'), expenses: await db.all('expenses'), photos,
    cousinPayments: (await db.kv('cousinPayments')) || [],
    promotions: (await db.kv('promotions')) || [],
    clients: (await db.kv('clients')) || [],
    journal: (await db.kv('journal')) || [],
    clotures: (await db.kv('clotures')) || [],
  };
}

export async function importAll(data) {
  // MonPressing reprend aussi les sauvegardes de Smart Pressing
  if (!data || !['monpressing', 'smart-pressing'].includes(data.app)) throw new Error('Ce fichier n’est pas une sauvegarde MonPressing ou Smart Pressing.');
  for (const s of ['articles', 'orders', 'expenses', 'photos']) await db.clear(s);
  await db.kv('settings', data.settings || {});
  for (const a of data.articles || []) await db.put('articles', a);
  for (const o of data.orders || []) await db.put('orders', o);
  for (const e of data.expenses || []) await db.put('expenses', e);
  for (const [k, v] of Object.entries(data.photos || {})) await db.put('photos', v, k);
  await db.kv('cousinPayments', data.cousinPayments || []);
  if (data.promotions) { await db.kv('promotions', data.promotions); await db.kv('promosMigrated', true); }
  if (data.clients) { await db.kv('clients', data.clients); await db.kv('clientsMigrated', true); }
  else { await db.kv('clients', []); await db.kv('clientsMigrated', false); }
  await db.kv('journal', data.journal || []);
  await db.kv('clotures', data.clotures || []);
  await db.kv('initialized', nowIso());
}

// ---------- montant en lettres (factures) ----------
const UNITS = ['zéro', 'un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf', 'dix', 'onze', 'douze', 'treize', 'quatorze', 'quinze', 'seize'];
const TENS = ['', 'dix', 'vingt', 'trente', 'quarante', 'cinquante', 'soixante'];
function below100(n) {
  if (n <= 16) return UNITS[n];
  if (n < 20) return 'dix-' + UNITS[n - 10];
  if (n < 70) {
    const t = Math.floor(n / 10), u = n % 10;
    return TENS[t] + (u === 0 ? '' : u === 1 ? '-et-un' : '-' + UNITS[u]);
  }
  if (n < 80) return 'soixante' + (n === 71 ? '-et-onze' : '-' + below100(n - 60));
  if (n === 80) return 'quatre-vingts';
  return 'quatre-vingt-' + below100(n - 80);
}
function below1000(n) {
  const c = Math.floor(n / 100), r = n % 100;
  let s = '';
  if (c > 0) s = (c > 1 ? UNITS[c] + '-cent' : 'cent') + (c > 1 && r === 0 ? 's' : '');
  if (r > 0) s += (s ? '-' : '') + below100(r);
  return s;
}
export function numberToWords(n) {
  n = Math.round(n);
  if (n === 0) return 'zéro';
  const parts = [];
  const mil = Math.floor(n / 1e9), mio = Math.floor((n % 1e9) / 1e6), th = Math.floor((n % 1e6) / 1000), rest = n % 1000;
  if (mil) parts.push(below1000(mil) + '-milliard' + (mil > 1 ? 's' : ''));
  if (mio) parts.push(below1000(mio) + '-million' + (mio > 1 ? 's' : ''));
  if (th) parts.push(th === 1 ? 'mille' : below1000(th).replace(/s$/, '') + '-mille');
  if (rest) parts.push(below1000(rest));
  return parts.join('-');
}

// ---------- bilan mensuel automatique ----------
// Renvoie les bilans à proposer : le mois écoulé, et en janvier l'année écoulée.
export async function pendingReports(s) {
  if (s.monthlyReport === false) return [];
  const out = [];
  const snooze = await db.kv('reportSnooze');
  if (snooze === todayIso()) return [];
  const firstOrder = (await db.all('orders')).map((o) => o.createdAt).sort()[0];
  if (!firstOrder) return [];
  const pm = period('month', -1);
  if (firstOrder.slice(0, 10) <= pm.end && (await db.kv('reportDone:' + pm.start.slice(0, 7))) !== true) out.push(pm);
  if (new Date().getMonth() === 0) {
    const py = period('year', -1);
    if (firstOrder.slice(0, 10) <= py.end && (await db.kv('reportDone:' + py.start.slice(0, 4))) !== true) out.push(py);
  }
  return out;
}
export const reportKey = (p) => (p.kind === 'year' ? p.start.slice(0, 4) : p.start.slice(0, 7));

// ---------- promotions (créées par l'admin) ----------
export const PROMO_DAYS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
export async function getPromos() { return (await db.kv('promotions')) || []; }
export async function savePromos(list) { await db.kv('promotions', list); }

// L'ancienne « remise 10 % dès 5 000 F » devient une promotion modifiable (une seule fois).
export async function migrateVolumePromo() {
  if (await db.kv('promosMigrated')) return;
  const s = await getSettings();
  const list = await getPromos();
  if ((Number(s.volumeMin) || 0) > 0 && (Number(s.volumePercent) || 0) > 0) {
    list.push({ id: Date.now(), name: `${s.volumePercent} % dès ${money(s.volumeMin)}`, type: 'percent', value: Number(s.volumePercent),
      scope: 'all', articles: [], minAmount: Number(s.volumeMin), from: '', to: '', days: [], auto: true, active: true });
    await savePromos(list);
  }
  await saveSettings({ ...s, volumeMin: 0 });
  await db.kv('promosMigrated', true);
}

export function promoActiveNow(p, now = new Date()) {
  if (!p.active) return false;
  const d = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  if (p.from && d < p.from) return false;
  if (p.to && d > p.to) return false;
  if (p.days && p.days.length && !p.days.includes((now.getDay() + 6) % 7)) return false;
  return true;
}
// lines : [{ articleId, qty, price }] ; renvoie le montant de remise (0 si non applicable)
export function promoAmount(p, lines, subtotal) {
  if (!promoActiveNow(p)) return 0;
  if ((Number(p.minAmount) || 0) > 0 && subtotal < Number(p.minAmount)) return 0;
  const target = p.scope === 'articles' ? lines.filter((l) => (p.articles || []).includes(l.articleId)) : lines;
  const base = target.reduce((s, l) => s + l.qty * l.price, 0);
  const pieces = target.reduce((s, l) => s + l.qty, 0);
  if (base <= 0) return 0;
  const v = Number(p.value) || 0;
  if (p.type === 'percent') return Math.round(base * Math.min(100, v) / 100);
  if (p.type === 'perPiece') return Math.min(base, Math.round(v * pieces));
  return Math.min(base, Math.round(v));
}
export function promoDescription(p, articles = []) {
  const v = p.type === 'percent' ? `${p.value} %` : p.type === 'perPiece' ? `${money(p.value)} par pièce` : money(p.value);
  const on = p.scope === 'articles' ? ' sur ' + (p.articles || []).map((id) => (articles.find((a) => a.id === id) || {}).name).filter(Boolean).join(', ') : '';
  const parts = [`−${v}${on}`];
  if (Number(p.minAmount) > 0) parts.push(`dès ${money(p.minAmount)}`);
  if (p.days && p.days.length) parts.push(p.days.map((d) => PROMO_DAYS[d]).join(' '));
  if (p.from || p.to) parts.push(`${p.from ? 'du ' + fmtDate(p.from, false) : ''} ${p.to ? 'au ' + fmtDate(p.to, false) : ''}`.trim());
  return parts.join(' · ');
}

// ---------- registre des clients ----------
export const SEX_LABEL = { M: 'Monsieur', F: 'Madame' };
export const civility = (sex) => SEX_LABEL[sex] || 'Monsieur/Madame';
export function clientDisplay(c) { return [String(c.lastName || '').trim().toUpperCase(), String(c.firstName || '').trim()].filter(Boolean).join(' '); }
export async function getClientsReg() { return (await db.kv('clients')) || []; }
export async function saveClientsReg(list) { await db.kv('clients', list); }
export async function getClientReg(id) { return (await getClientsReg()).find((c) => c.id === id) || null; }

export async function saveClient(c) {
  const list = await getClientsReg();
  if (!String(c.lastName || '').trim()) throw new Error('Indiquez au moins le nom du client.');
  const pk = phoneKey(c.phone);
  const dup = pk && list.find((x) => x.id !== c.id && phoneKey(x.phone) === pk);
  if (dup) throw new Error(`Ce numéro est déjà celui de ${clientDisplay(dup)}.`);
  const rec = { arrears: 0, note: '', sex: '', firstName: '', ...c, lastName: c.lastName.trim(), firstName: (c.firstName || '').trim(), phone: (c.phone || '').trim(), arrears: Math.max(0, Math.round(Number(c.arrears) || 0)) };
  if (!rec.id) { rec.id = Date.now() + Math.floor(Math.random() * 1000); rec.createdAt = nowIso(); list.push(rec); }
  else { const i = list.findIndex((x) => x.id === rec.id); if (i >= 0) list[i] = { ...list[i], ...rec }; else list.push(rec); }
  await saveClientsReg(list);
  // garder les factures alignées sur la fiche (nom, téléphone, sexe)
  for (const o of await db.all('orders')) if (o.clientId === rec.id) {
    o.clientName = clientDisplay(rec); o.clientPhone = rec.phone; o.clientSex = rec.sex; await saveOrder(o);
  }
  return rec;
}

// Première ouverture de cette version : chaque client des anciennes factures reçoit une fiche.
export async function migrateClients() {
  if (await db.kv('clientsMigrated')) return;
  const list = await getClientsReg();
  const orders = (await db.all('orders')).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  for (const o of orders) {
    if (o.clientId && list.find((c) => c.id === o.clientId)) continue;
    const pk = phoneKey(o.clientPhone);
    let c = list.find((x) => (pk && phoneKey(x.phone) === pk) || (!pk && !phoneKey(x.phone) && clientDisplay(x).toLowerCase() === o.clientName.trim().toUpperCase().toLowerCase()));
    if (!c) {
      c = { id: Date.now() + list.length, lastName: o.clientName.trim(), firstName: '', sex: o.clientSex || '', phone: o.clientPhone || '', arrears: 0, note: '', createdAt: o.createdAt };
      list.push(c);
    } else if (o.clientPhone && !c.phone) c.phone = o.clientPhone;
    o.clientId = c.id; await saveOrder(o);
  }
  await saveClientsReg(list);
  await db.kv('clientsMigrated', true);
}

// Fiches + statistiques (commandes, dépensé, dû) ; les clients sans commande apparaissent aussi.
export function clientsWithStats(reg, orders) {
  const byId = new Map(reg.map((c) => [c.id, { ...c, key: 'id:' + c.id, name: clientDisplay(c), orders: [], spent: 0, due: 0, pieces: 0, firstAt: c.createdAt || '', lastAt: c.createdAt || '' }]));
  for (const o of orders.slice().sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
    const c = byId.get(o.clientId); if (!c) continue;
    const t = orderTotals(o);
    c.orders.push(o); c.spent += t.sales; c.due += t.due; c.pieces += t.pieces;
    if (!c.firstAt || o.createdAt < c.firstAt) c.firstAt = o.createdAt;
    if (o.createdAt > c.lastAt) c.lastAt = o.createdAt;
  }
  return [...byId.values()].map((c) => ({ ...c, totalDue: c.due + (c.arrears || 0) }));
}

// Montants d'arriéré connus pour un client : ancien solde de la fiche + restes des factures précédentes.
export async function knownArrears(clientId) {
  const c = await getClientReg(clientId);
  const open = (await db.all('orders')).filter((o) => o.clientId === clientId).map((o) => ({ o, due: orderTotals(o).due })).filter((x) => x.due > 0).sort((a, b) => a.o.number - b.o.number);
  return { fiche: c ? c.arrears || 0 : 0, invoices: open.map((x) => ({ number: x.o.number, due: x.due })) };
}

// Après émission : consommer l'ancien solde de la fiche et reporter les restes des anciennes factures.
export async function applyArrears(newOrder, { fromFiche = 0, fromInvoices = [] }) {
  if (fromFiche > 0 && newOrder.clientId) {
    const list = await getClientsReg();
    const c = list.find((x) => x.id === newOrder.clientId);
    if (c) { c.arrears = Math.max(0, (c.arrears || 0) - fromFiche); await saveClientsReg(list); }
  }
  for (const n of fromInvoices) {
    const o = await getOrder(n); if (!o) continue;
    const due = orderTotals(o).due; if (due <= 0) continue;
    o.transfers = o.transfers || [];
    o.transfers.push({ amount: due, toOrder: newOrder.number, at: nowIso() });
    o.events.push({ status: o.status, note: `Reste ${money(due)} reporté sur la facture N°${newOrder.number}`, at: nowIso() });
    syncPaid(o); await saveOrder(o);
  }
}

// ---------- messages WhatsApp ----------
// Nom utilisé dans les messages : le prénom, sinon le nom.
export function lastNameOf(o, reg) {
  const c = reg && reg.find((x) => x.id === o.clientId);
  if (c && String(c.firstName || '').trim()) return String(c.firstName).trim().replace(/^./, (x) => x.toUpperCase());
  return c ? String(c.lastName || '').trim().toUpperCase() : o.clientName.trim().split(/\s+/)[0].toUpperCase();
}
export function readyMessage(o, reg, s) {
  return `Bonjour ${civility(o.clientSex)} ${lastNameOf(o, reg)}, vos habits sont prêts. Pouvons-nous passer ?\n\n${s.name || 'MonPressing'}`;
}
export function thanksMessage(o, reg, s, renewed) {
  return `Bonjour ${civility(o.clientSex)} ${lastNameOf(o, reg)},\nToute l'équipe ${s.name || 'MonPressing'} vous remercie pour votre confiance${renewed ? ' encore renouvelée' : ''}. Vos suggestions et critiques sont les bienvenues.`;
}

// ---------- prix spécifiques par client ----------
export async function setClientPrices(clientId, changes) {
  const list = await getClientsReg();
  const c = list.find((x) => x.id === clientId); if (!c) return;
  c.prices = { ...(c.prices || {}) };
  for (const [id, v] of Object.entries(changes)) { if (v == null) delete c.prices[id]; else c.prices[id] = Math.max(0, Math.round(Number(v))); }
  await saveClientsReg(list);
}

// ---------- relances des impayés ----------
const DAY = 864e5;
const isoAddDays = (iso, d) => { const t = new Date(iso.slice(0, 19)); t.setTime(t.getTime() + d * DAY); return t; };
export function deliveredAt(o) {
  const e = (o.events || []).filter((x) => x.status === STATUS.LIVRE).pop();
  return e ? e.at : null;
}
// Pour chaque facture livrée avec un reste : quand faut-il la relancer ?
function orderReminder(o, s) {
  const t = orderTotals(o);
  const at = deliveredAt(o);
  if (o.status !== STATUS.LIVRE || t.due <= 0 || !at || !o.clientPhone) return null;
  const sent = (o.reminders || []);
  if (sent.length >= (Number(s.remindMax) || 3)) return { o, t, done: true };
  const last = sent.length ? sent[sent.length - 1].at : null;
  let next = last ? isoAddDays(last, Number(s.remindEvery) || 7) : isoAddDays(at, Number(s.remindAfter) || 7);
  if (o.remindSnooze) { const sn = new Date(o.remindSnooze + 'T00:00:00'); if (sn > next) next = sn; }
  return { o, t, next, count: sent.length };
}
// Clients à relancer maintenant (un message par client, toutes ses factures dues), et prochaine échéance.
export function reminderPlan(orders, reg, s, now = new Date()) {
  const groups = new Map(); let nextAt = null;
  if (s.remindOn === false) return { due: [], nextAt: null };
  for (const o of orders) {
    const r = orderReminder(o, s); if (!r || r.done) continue;
    if (r.next <= now) {
      const k = o.clientId ? 'c' + o.clientId : 'tel:' + phoneKey(o.clientPhone);
      const g = groups.get(k) || { key: k, clientId: o.clientId, phone: o.clientPhone, sex: o.clientSex, name: o.clientName, items: [], total: 0, count: 0 };
      g.items.push({ number: o.number, due: r.t.due, date: o.createdAt }); g.total += r.t.due; g.count = Math.max(g.count, r.count);
      groups.set(k, g);
    } else if (!nextAt || r.next < nextAt) nextAt = r.next;
  }
  const due = [...groups.values()].map((g) => ({ ...g, items: g.items.sort((a, b) => a.number - b.number), first: (reg || []).find((c) => c.id === g.clientId) }))
    .sort((a, b) => b.total - a.total);
  return { due, nextAt };
}
export function reminderMessage(g, s) {
  const c = g.first;
  const name = c ? (String(c.firstName || '').trim() ? String(c.firstName).trim().replace(/^./, (x) => x.toUpperCase()) : String(c.lastName || '').toUpperCase()) : g.name.split(/\s+/)[0];
  const civ = civility(c ? c.sex : g.sex);
  const inv = g.items.length === 1
    ? `sur votre facture N°${g.items[0].number} du ${fmtDate(g.items[0].date, false).slice(0, 5)}`
    : `sur vos factures ${g.items.map((x) => 'N°' + x.number).join(', ').replace(/, ([^,]*)$/, ' et $1')}`;
  return `Bonjour ${civ} ${name}, nous espérons que vous allez bien. Sauf erreur de notre part, il reste un solde de ${money(g.total)} ${inv}. Vous pouvez le régler à votre prochain passage ou par Mobile Money. Merci pour votre confiance ! — ${s.name || 'MonPressing'}`;
}
export async function markReminded(g, skipDays = 0) {
  for (const it of g.items) {
    const o = await getOrder(it.number); if (!o) continue;
    if (skipDays) { const d = new Date(Date.now() + skipDays * DAY); o.remindSnooze = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
    else {
      o.reminders = o.reminders || [];
      o.reminders.push({ at: nowIso(), amount: it.due });
      o.events.push({ status: o.status, note: `Relance WhatsApp n°${o.reminders.length} (${money(it.due)})`, at: nowIso() });
    }
    await saveOrder(o);
  }
}
