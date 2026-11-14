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
  name: 'Smart Pressing', city: '', phone: '', logo: '',
  cousinRate: 400, deliveryFee: 500, savingsPercent: 25, invoiceStart: 1, adminPin: '',
  dueDays: 2, loyaltyEvery: 10, loyaltyType: 'percent', loyaltyValue: 20, monthlyReport: true,
  volumeMin: 5000, volumePercent: 10,
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
  const total = items + (o.deliveryFee || 0) - discount;
  const paid = paidAmount(o, total);
  return { items, discount, total, estKg, washKg, wash, margin: total - wash, pieces: o.pieces.length, paid, due: Math.max(0, total - paid) };
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
  o.paid = t.total > 0 ? t.paid >= t.total : true;
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
    c.orders.push(o); c.spent += t.total; c.due += t.due; c.pieces += t.pieces;
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

export async function createOrder({ clientName, clientPhone, quantities, weighedKg, delivery, deliveryPlace, deliveryAt, dueAt, discount, deposit }) {
  const s = await getSettings();
  const arts = await getArticles();
  const items = [];
  for (const a of arts) {
    const q = quantities[a.id] || 0;
    if (q > 0) items.push({ name: a.name, qty: q, price: a.price, weight: a.weight, homeWash: !!a.homeWash });
  }
  if (!clientName.trim()) throw new Error('Indiquez le nom du client.');
  if (!items.length) throw new Error('Ajoutez au moins un article.');
  const pieces = [];
  let idx = 1;
  for (const it of items) for (let k = 0; k < it.qty; k++) pieces.push({ index: idx++, name: it.name, homeWash: it.homeWash, checks: {} });
  const number = await nextNumber();
  const order = {
    number, clientName: clientName.trim(), clientPhone: (clientPhone || '').trim(),
    status: STATUS.RECU, createdAt: nowIso(),
    weighedKg: weighedKg === '' || weighedKg == null ? null : Number(weighedKg),
    deliveryFee: delivery ? Number(s.deliveryFee) || 0 : 0,
    deliveryPlace: delivery ? (deliveryPlace || '').trim() : '',
    deliveryAt: delivery && deliveryAt ? deliveryAt : null,
    cousinRate: Number(s.cousinRate) || 0,
    dueAt: dueAt || (delivery && deliveryAt ? deliveryAt : null),
    discount: discount && discount.amount > 0 ? { amount: Math.round(discount.amount), label: discount.label || 'Remise' } : null,
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
    if (o.createdAt.slice(0, 10) === today) { c.todayCount++; c.todayCA += orderTotals(o).total; }
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
    r.ca += t.total; r.washKg += t.washKg; r.wash += t.wash;
    r.cashed += Math.min(t.paid, t.total); r.unpaid += t.due;
    for (const i of o.items) r.articles[i.name] = (r.articles[i.name] || 0) + i.qty;
    const day = o.createdAt.slice(0, 10), mon = o.createdAt.slice(0, 7);
    r.byDay[day] = (r.byDay[day] || 0) + t.total;
    const bm = (r.byMonth[mon] = r.byMonth[mon] || { ca: 0, wash: 0, exp: 0, inv: 0 });
    bm.ca += t.total; bm.wash += t.wash;
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
    app: 'smart-pressing', version: 1, exportedAt: nowIso(),
    settings: await db.kv('settings'), articles: await db.all('articles'),
    orders: await db.all('orders'), expenses: await db.all('expenses'), photos,
    cousinPayments: (await db.kv('cousinPayments')) || [],
  };
}

export async function importAll(data) {
  if (!data || data.app !== 'smart-pressing') throw new Error('Ce fichier n’est pas une sauvegarde Smart Pressing.');
  for (const s of ['articles', 'orders', 'expenses', 'photos']) await db.clear(s);
  await db.kv('settings', data.settings || {});
  for (const a of data.articles || []) await db.put('articles', a);
  for (const o of data.orders || []) await db.put('orders', o);
  for (const e of data.expenses || []) await db.put('expenses', e);
  for (const [k, v] of Object.entries(data.photos || {})) await db.put('photos', v, k);
  await db.kv('cousinPayments', data.cousinPayments || []);
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
