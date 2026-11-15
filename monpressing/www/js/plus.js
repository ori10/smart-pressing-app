// MonPressing : ce qui s'ajoute à Smart Pressing (aide à la décision, caisse, assistant, détachage, dictée).
// Tout fonctionne sans internet ; l'IA (ia.js) vient en plus quand elle est configurée.
import { db } from './db.js';
import * as L from './logic.js';

const { STATUS, money, orderTotals, pad } = L;
const DAY = 864e5;
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const ageDays = (iso) => Math.max(0, Math.floor((Date.now() - new Date(String(iso).slice(0, 19)).getTime()) / DAY));
export const JOURS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];

// ---------------------------------------------------------------- journal (actions sensibles)
export async function journal() { return (await db.kv('journal')) || []; }
export async function logJ(type, o, montant, info = '') {
  const j = await journal();
  j.push({ type, number: o ? o.number : null, client: o ? o.clientName : '', montant: Math.round(montant || 0), info, at: L.nowIso() });
  await db.kv('journal', j.slice(-500));
}

// ---------------------------------------------------------------- date de rendu conseillée
export const PLUIES_DEFAUT = [4, 5, 6, 7, 9, 10, 11];
export function dateConseillee(S, orders, { maison = false } = {}) {
  const raisons = [];
  let j = Number(S.dueDays) || 2;
  const pluies = Array.isArray(S.moisPluies) ? S.moisPluies : PLUIES_DEFAUT;
  if (pluies.includes(new Date().getMonth() + 1)) { j += 1; raisons.push('saison des pluies : séchage plus long'); }
  const enCours = orders.filter((o) => o.status < STATUS.PRET).reduce((s, o) => s + o.pieces.length, 0);
  const cap = Number(S.capaciteJour) || 40;
  if (enCours > cap) { const x = Math.min(3, Math.floor(enCours / cap)); j += x; raisons.push(`atelier chargé : ${enCours} pièces en cours`); }
  if (maison && j > 1) { j -= 1; raisons.push('lavage maison : pas d’aller-retour chez le cousin'); }
  const t = new Date(); let n = 0;
  while (n < j) { t.setDate(t.getDate() + 1); if (t.getDay() !== 0) n++; } // le dimanche ne compte pas
  return { value: `${ymd(t)}T17:00`, raisons };
}

// ---------------------------------------------------------------- profil de paiement d'un client
export function groupeClient(orders, o) {
  const k = o.clientId ? 'id:' + o.clientId : L.clientKey(o);
  return orders.filter((x) => (x.clientId ? 'id:' + x.clientId : L.clientKey(x)) === k);
}
export function risque(ordersClient) {
  const imp = ordersClient.filter((o) => orderTotals(o).due > 0);
  const solde = imp.reduce((s, o) => s + orderTotals(o).due, 0);
  if (!solde) return { score: 0, label: 'À jour', tone: 'green', solde: 0, jours: 0, nb: 0 };
  const jours = Math.max(...imp.map((o) => ageDays(o.createdAt)));
  const livresImpayes = imp.filter((o) => o.status === STATUS.LIVRE).length;
  const payes = ordersClient.filter((o) => orderTotals(o).due <= 0).length;
  let score = Math.min(40, jours) + imp.length * 8 + livresImpayes * 15 - Math.min(20, payes * 2) + (solde > 20000 ? 15 : solde > 5000 ? 8 : 0);
  score = Math.max(0, Math.min(100, score));
  return {
    score, solde, jours, nb: imp.length,
    label: score >= 60 ? 'Risque élevé' : score >= 30 ? 'À surveiller' : 'Bon payeur en retard',
    tone: score >= 60 ? 'red' : score >= 30 ? 'orange' : 'green',
  };
}
export function momentRelance() {
  const d = new Date().getDate();
  return d >= 25 || d <= 5
    ? { bon: true, txt: 'Bon moment pour relancer : c’est la période de paie (fin et début de mois).' }
    : { bon: false, txt: `Les relances marchent mieux entre le 25 et le 5 du mois (dans ${25 - d} jours).` };
}

// ---------------------------------------------------------------- caisse
export async function clotures() { return (await db.kv('clotures')) || []; }
export function encaisseLe(orders, day) {
  let total = 0, n = 0;
  for (const o of orders) for (const p of o.payments || []) if (String(p.at).slice(0, 10) === day) { total += Number(p.amount) || 0; n++; }
  return { total, n };
}
export async function cloturer(orders, { especes, momo, note, qui }) {
  const day = L.todayIso(), att = encaisseLe(orders, day).total;
  const c = { id: Date.now(), date: day, at: L.nowIso(), especes: Math.round(Number(especes) || 0), momo: Math.round(Number(momo) || 0), note: note || '', qui: qui || '', attendu: att };
  c.ecart = c.especes + c.momo - att;
  const list = (await clotures()).filter((x) => x.date !== day);
  list.push(c);
  await db.kv('clotures', list.slice(-400));
  return c;
}

// Alertes pour le patron, sur les 30 derniers jours.
export async function alertes(orders) {
  const res = [], depuis = ymd(new Date(Date.now() - 30 * DAY));
  for (const c of await clotures()) {
    if (c.date < depuis || Math.abs(c.ecart) < 500) continue;
    res.push({ tone: c.ecart < 0 ? 'red' : 'orange', txt: `Caisse du ${L.fmtDate(c.date, false)} : écart de ${c.ecart > 0 ? '+' : ''}${money(c.ecart)} (compté ${money(c.especes + c.momo)}, enregistré ${money(c.attendu)})${c.qui ? ' — ' + c.qui : ''}.` });
  }
  const j = (await journal()).filter((x) => x.at.slice(0, 10) >= depuis);
  const supp = j.filter((x) => x.type === 'suppression'), annul = j.filter((x) => x.type === 'paiements_annules');
  if (supp.length >= 2) res.push({ tone: 'red', txt: `${supp.length} factures supprimées ces 30 derniers jours (${supp.map((x) => 'N°' + x.number).join(', ')}).` });
  if (annul.length >= 2) res.push({ tone: 'red', txt: `Paiements annulés sur ${annul.length} factures ces 30 derniers jours (${annul.map((x) => 'N°' + x.number).join(', ')}).` });
  const recents = orders.filter((o) => o.createdAt.slice(0, 10) >= depuis);
  const remises = recents.filter((o) => o.discount && /remise/i.test(o.discount.label || ''));
  if (remises.length >= 3 && remises.length / Math.max(1, recents.length) > 0.2) res.push({ tone: 'orange', txt: `Remise libre accordée sur ${remises.length} factures sur ${recents.length} ce mois-ci.` });
  const nonSoldes = orders.filter((o) => (o.events || []).some((e) => e.note === 'Livré non soldé' && e.at.slice(0, 10) >= depuis));
  if (nonSoldes.length >= 3) res.push({ tone: 'orange', txt: `${nonSoldes.length} commandes livrées sans paiement complet ces 30 derniers jours.` });
  return res;
}

// ---------------------------------------------------------------- idées de promotions (calendrier béninois)
function paques(y) { const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451), mo = Math.floor((h + l - 7 * m + 114) / 31), da = ((h + l - 7 * m + 114) % 31) + 1; return new Date(y, mo - 1, da); }
const FETES_MUSULMANES = { 2026: [['Tabaski', 4, 27]], 2027: [['Ramadan (Korité)', 2, 10], ['Tabaski', 4, 17]], 2028: [['Ramadan (Korité)', 1, 27], ['Tabaski', 4, 5]] };
const TENUES = /bazin|boubou|pagne|complet|ensemble|tenue|agbada/i;
function evenements(y) {
  const ev = [
    { nom: 'Fête du Vodoun', date: new Date(y, 0, 10), avant: 10, promo: 'Spécial 10 janvier', pourquoi: 'beaucoup de tenues traditionnelles à préparer', tenues: true },
    { nom: 'Pâques', date: paques(y), avant: 10, promo: 'Tenues de Pâques', pourquoi: 'les familles préparent leurs tenues pour l’église' },
    { nom: 'Fête de l’Indépendance', date: new Date(y, 7, 1), avant: 10, promo: 'Spécial 1er août', pourquoi: 'défilés, cérémonies et sorties' },
    { nom: 'Rentrée scolaire', date: new Date(y, 8, 14), avant: 14, promo: 'Uniformes de rentrée', pourquoi: 'les parents font laver uniformes et tenues', approx: true },
    { nom: 'Fêtes de fin d’année', date: new Date(y, 11, 24), avant: 21, promo: 'Fêtes de fin d’année', pourquoi: 'mariages, sorties et tenues de fête' },
  ];
  for (const [n, m, d] of FETES_MUSULMANES[y] || []) ev.push({ nom: n, date: new Date(y, m, d), avant: 10, promo: 'Spécial ' + n, pourquoi: 'beaucoup de boubous et tenues à préparer', approx: true, tenues: true });
  return ev;
}
export function evenementsProches(n) {
  const y = new Date().getFullYear(), now = Date.now();
  return [...evenements(y), ...evenements(y + 1)].filter((e) => e.date.getTime() >= now - DAY && e.date.getTime() <= now + n * DAY).sort((a, b) => a.date - b.date);
}
// Brouillons au format des promotions Smart Pressing (days : 0 = lundi … 6 = dimanche).
export function ideesPromos(orders, arts) {
  const out = [], tenues = arts.filter((a) => TENUES.test(a.name)).map((a) => a.id);
  const recents = orders.filter((o) => ageDays(o.createdAt) <= 56);
  if (recents.length >= 10) {
    const by = [0, 0, 0, 0, 0, 0, 0];
    for (const o of recents) by[new Date(o.createdAt.slice(0, 19)).getDay()] += orderTotals(o).sales;
    const ouverts = [1, 2, 3, 4, 5, 6], min = ouverts.reduce((a, b) => (by[b] < by[a] ? b : a)), moy = ouverts.reduce((s, d) => s + by[d], 0) / 6;
    if (moy && by[min] < moy * 0.7) out.push({ name: `${JOURS[min][0].toUpperCase() + JOURS[min].slice(1)} malin`, type: 'percent', value: 15, scope: 'all', articles: [], days: [(min + 6) % 7], raison: `Le ${JOURS[min]} est votre jour le plus calme (${Math.round(by[min] / moy * 100)} % de la moyenne des autres jours).` });
  }
  for (const e of evenementsProches(45)) {
    const from = ymd(new Date(Math.max(Date.now(), e.date.getTime() - e.avant * DAY)));
    const art = e.tenues && tenues.length ? tenues : [];
    out.push({ name: e.promo, type: 'percent', value: 10, scope: art.length ? 'articles' : 'all', articles: art, from, to: ymd(e.date), raison: `${e.nom} le ${L.fmtDate(ymd(e.date), false)}${e.approx ? ' (date approximative)' : ''} : ${e.pourquoi}.` });
  }
  const m = new Date().getMonth() + 1;
  if ((m === 11 || m === 12) && tenues.length) out.push({ name: 'Forfait cérémonie', type: 'percent', value: 10, scope: 'articles', articles: tenues, minAmount: 5000, to: `${new Date().getFullYear()}-12-31`, raison: 'Saison des mariages et des cérémonies : fidélisez les familles qui apportent plusieurs tenues.' });
  return out.map((p) => ({ auto: false, active: true, minAmount: 0, from: '', to: '', days: [], ...p }));
}

// ---------------------------------------------------------------- assistant du patron
function debutPeriode(per) { const d = new Date(); d.setHours(0, 0, 0, 0); if (per === 'semaine') d.setDate(d.getDate() - (d.getDay() + 6) % 7); if (per === 'mois') d.setDate(1); if (per === 'annee') d.setMonth(0, 1); return ymd(d); }
const LIB = { jour: "aujourd'hui", semaine: 'cette semaine', mois: 'ce mois', annee: 'cette année' };
function encaissePeriode(orders, debut, fin = '9999') {
  let enc = 0, fact = 0, nf = 0;
  for (const o of orders) {
    for (const p of o.payments || []) { const d = String(p.at).slice(0, 10); if (d >= debut && d < fin) enc += Number(p.amount) || 0; }
    const d = o.createdAt.slice(0, 10); if (d >= debut && d < fin) { fact += orderTotals(o).sales; nf++; }
  }
  return { enc, fact, nf };
}
export function debiteurs(orders) {
  const map = new Map();
  for (const o of orders) { const k = o.clientId ? 'id:' + o.clientId : L.clientKey(o); if (!map.has(k)) map.set(k, []); map.get(k).push(o); }
  return [...map.values()].map((os) => ({ nom: os[os.length - 1].clientName, phone: os.find((o) => o.clientPhone)?.clientPhone || '', r: risque(os) }))
    .filter((x) => x.r.solde > 0).sort((a, b) => b.r.score - a.r.score || b.r.solde - a.r.solde);
}
export function reponseLocale(q, orders, expenses) {
  const t = norm(q), per = /aujourd|ce jour/.test(t) ? 'jour' : /semaine/.test(t) ? 'semaine' : /annee|cette an/.test(t) ? 'annee' : 'mois';
  if (/resume|bilan de la semaine|resume de la semaine/.test(t)) return resumeSemaine(orders, expenses);
  if (/depense/.test(t)) { const d0 = debutPeriode(per), es = expenses.filter((e) => e.date >= d0); return `Dépenses ${LIB[per]} : ${money(es.reduce((s, e) => s + e.amount, 0))} (${es.length} dépense(s)).`; }
  if (/gagne|chiffre|recette|encaiss|vendu|revenu|argent/.test(t)) { const r = encaissePeriode(orders, debutPeriode(per)); return `Encaissé ${LIB[per]} : ${money(r.enc)}.\nFacturé ${LIB[per]} : ${money(r.fact)} sur ${r.nf} facture(s).`; }
  if (/doit|dette|impaye|arriere|credit/.test(t)) { const d = debiteurs(orders); return d.length ? `Impayés au total : ${money(d.reduce((s, x) => s + x.r.solde, 0))}.\n` + d.slice(0, 5).map((x, i) => `${i + 1}. ${x.nom} : ${money(x.r.solde)} (${x.r.label}, ${x.r.jours} j)`).join('\n') : 'Personne ne vous doit d’argent. Bravo !'; }
  if (/cousin/.test(t)) { const c = orders.filter((o) => o.status === STATUS.COUSIN); return `Chez le cousin : ${c.length} commande(s), ${c.reduce((s, o) => s + L.cousinPieces(o).length, 0)} pièce(s).\nÀ envoyer : ${orders.filter((o) => o.status === STATUS.RECU).length} commande(s).`; }
  if (/pret|retir|attente|livr/.test(t)) { const p = orders.filter((o) => o.status === STATUS.PRET); return p.length ? `${p.length} commande(s) prête(s) :\n` + p.slice(0, 10).map((o) => `• N°${o.number} ${o.clientName}${orderTotals(o).due ? ' (reste ' + money(orderTotals(o).due) + ')' : ''}`).join('\n') : 'Aucune commande prête en attente.'; }
  if (/retard/.test(t)) { const l = orders.filter((o) => L.lateness(o) === 'late'); return l.length ? `${l.length} commande(s) en retard :\n` + l.slice(0, 10).map((o) => `• N°${o.number} ${o.clientName}, promis ${L.fmtShort(L.dueDate(o))}`).join('\n') : 'Aucune commande en retard.'; }
  if (/client/.test(t) && /meilleur|fidele|top|plus gros/.test(t)) { const m = {}; for (const o of orders.filter((x) => ageDays(x.createdAt) <= 90)) m[o.clientName] = (m[o.clientName] || 0) + orderTotals(o).sales; const top = Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 5); return top.length ? 'Meilleurs clients (90 jours) :\n' + top.map(([n, v], i) => `${i + 1}. ${n} : ${money(v)}`).join('\n') : 'Pas encore assez de données.'; }
  return null;
}
export function resumeSemaine(orders, expenses) {
  const d0 = debutPeriode('semaine'), prec = ymd(new Date(new Date(d0).getTime() - 7 * DAY));
  const cur = encaissePeriode(orders, d0), avant = encaissePeriode(orders, prec, d0);
  const evo = avant.enc ? Math.round((cur.enc - avant.enc) / avant.enc * 100) : null;
  const dep = expenses.filter((e) => e.date >= d0).reduce((s, e) => s + e.amount, 0), deb = debiteurs(orders);
  return `Résumé de la semaine (depuis lundi)\n• Encaissé : ${money(cur.enc)}${evo !== null ? ` (${evo >= 0 ? '+' : ''}${evo} % par rapport à la semaine dernière entière)` : ''}\n• Factures : ${cur.nf} pour ${money(cur.fact)}\n• Dépenses : ${money(dep)}\n• Impayés au total : ${money(deb.reduce((s, x) => s + x.r.solde, 0))}${deb.length ? '\n• À relancer en priorité : ' + deb.slice(0, 3).map((x) => `${x.nom} (${money(x.r.solde)})`).join(', ') : ''}\n• Chez le cousin : ${orders.filter((o) => o.status === STATUS.COUSIN).length} commande(s)`;
}
export function donneesIA(orders, expenses, S) {
  const mois = [];
  for (let i = 5; i >= 0; i--) { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - i); const f = new Date(d); f.setMonth(f.getMonth() + 1); const r = encaissePeriode(orders, ymd(d), ymd(f)); mois.push({ mois: L.monthName(d.getMonth()) + ' ' + d.getFullYear(), facture: r.fact, encaisse: r.enc, depenses: expenses.filter((e) => e.date >= ymd(d) && e.date < ymd(f)).reduce((s, e) => s + e.amount, 0) }); }
  const art = {};
  for (const o of orders.filter((x) => ageDays(x.createdAt) <= 90)) for (const i of o.items) art[i.name] = (art[i.name] || 0) + i.qty;
  return {
    pressing: S.name, date: L.todayIso(), par_mois: mois,
    encaisse: { jour: encaissePeriode(orders, debutPeriode('jour')), semaine: encaissePeriode(orders, debutPeriode('semaine')), mois: encaissePeriode(orders, debutPeriode('mois')) },
    debiteurs: debiteurs(orders).slice(0, 10).map((x) => ({ nom: x.nom, doit: x.r.solde, jours: x.r.jours, profil: x.r.label })),
    commandes: L.STATUS_LABEL.map((l, i) => ({ etape: l, nombre: orders.filter((o) => o.status === i).length })),
    en_retard: orders.filter((o) => L.lateness(o) === 'late').length,
    articles_90_jours: Object.entries(art).sort((a, b) => b[1] - a[1]).slice(0, 8),
    tarif_cousin_par_kg: S.cousinRate,
  };
}

// ---------------------------------------------------------------- dictée (sans IA)
const NOMBRES = { un: 1, une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, six: 6, sept: 7, huit: 8, neuf: 9, dix: 10, onze: 11, douze: 12, quinze: 15, vingt: 20 };
export function lireDictee(texte, arts, clients) {
  const t = norm(texte), lignes = [];
  const tri = arts.slice().sort((a, b) => b.name.length - a.name.length);
  for (let seg of t.split(/,|;|\bet\b|\bpuis\b|\bplus\b/)) {
    seg = seg.trim(); if (!seg) continue;
    const sing = seg.replace(/s\b/g, '');
    let a = tri.find((x) => seg.includes(norm(x.name)) || sing.includes(norm(x.name).replace(/s\b/g, '')));
    if (!a) a = tri.find((x) => { const w = norm(x.name).split(/[\s/()-]+/)[0]; return w.length > 3 && new RegExp('\\b' + w + 's?\\b').test(seg); });
    if (!a) continue;
    const reste = seg.replace(norm(a.name), ' ');
    let q = 1; const m = reste.match(/\b(\d+)\b/);
    if (m) q = Number(m[1]); else for (const [w, v] of Object.entries(NOMBRES)) if (new RegExp('\\b' + w + '\\b').test(reste)) { q = v; break; }
    lignes.push({ article: a.name, qte: q });
  }
  const c = clients.find((x) => { const n = norm(x.name); return n.length > 2 && t.includes(n); })
    || clients.find((x) => norm(x.name).split(/\s+/).some((p) => p.length > 3 && new RegExp('\\b' + p + '\\b').test(t)));
  let client = c ? c.name : null;
  if (!client) { const mc = t.match(/pour (?:madame|monsieur|mme|mr|mademoiselle|mlle|maman|papa|tonton|tata)?\s*([a-z\- ]{2,40}?)(?:,|\.|$| avec)/); if (mc) client = mc[1].trim(); }
  return { lignes, client };
}

// ---------------------------------------------------------------- guide de détachage (hors ligne)
export const GUIDE = [
  ['Huile, graisse, huile rouge, beurre de karité', 'Saupoudrez tout de suite du talc ou de l’amidon, laissez absorber 30 min et brossez. Mettez ensuite un peu de liquide vaisselle sur la tache, frottez doucement et lavez à l’eau tiède.'],
  ['Terre rouge (latérite), boue', 'Laissez bien sécher, puis brossez à sec pour enlever le maximum. Prétraitez au savon et lavez à l’eau froide. Ne frottez pas la boue mouillée : elle rentre dans les fibres.'],
  ['Sang', 'Eau FROIDE uniquement (l’eau chaude fixe la tache). Tamponnez, puis savon et rinçage froid.'],
  ['Sueur, col et aisselles jaunis', 'Pâte de bicarbonate et d’eau, ou vinaigre blanc dilué, 30 min avant le lavage. Brossez doucement le col.'],
  ['Encre de stylo', 'Tamponnez avec de l’alcool à 70° sur un chiffon blanc, de l’extérieur vers le centre. Changez souvent de chiffon.'],
  ['Rouille', 'Jus de citron et sel, au soleil quelques minutes, puis rinçage. À éviter sur les couleurs fragiles.'],
  ['Mangue, fruits, jus, sauce tomate', 'Rincez vite à l’eau froide par l’envers, puis savon. Plus on attend, plus la tache se fixe.'],
  ['Cire de bougie', 'Grattez la cire durcie, posez du papier absorbant dessus et passez un fer tiède.'],
  ['Précautions par tissu', 'Wax et pagne : testez la couleur sur un coin caché, eau froide, jamais de javel. Bazin : pas de javel sur les couleurs, lavage doux, amidonnez après. Soie et tissus délicats : ne frottez pas, nettoyage à sec. Dans tous les cas, testez d’abord sur une partie cachée.'],
];
