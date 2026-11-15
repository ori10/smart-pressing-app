import { db } from './db.js';
import { SEED } from './seed.js';
import * as L from './logic.js';
import { invoicePdf, ticketPdf } from './pdf.js';
import { bilanPdf, bilanXlsx, bilanFileName } from './export.js';
import * as Charts from './charts.js';
import * as Cloud from './cloud.js';
import { shareFile, saveFile, openExternal, waNumber, isNative, scheduleMonthlyReminder, waOpen, waSendImage } from './native.js';
import { thanksCard } from './card.js';
import { beep } from './scan.js';

const { STATUS, STATUS_LABEL, STATUS_TONE, money, fmtDate, fmtShort, orderTotals, pieceCode, orderCode } = L;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let S = null;            // réglages en cache
let unlocked = false;    // mode administrateur déverrouillé (jusqu'à fermeture de l'appli)
let cleanup = null;      // fonction appelée en quittant un écran
let connected = false;   // on passe par l'écran « Bienvenue » à chaque ouverture de l'appli
let REG = [];            // fiches clients en cache
const isAdmin = () => !S.adminPin || unlocked;

// ---------------------------------------------------------------- outils d'affichage
const ICONS = {
  home: '<path d="M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  truck: '<path d="M1 4h14v12H1zM15 9h4l3 3v4h-7M5.5 19.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM18.5 19.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z"/>',
  more: '<path d="M4 6h16M4 12h16M4 18h16"/>',
};
const icon = (k, sw = 2) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">${ICONS[k]}</svg>`;

function setNav(active) {
  const items = [['home', '#/home', 'Accueil'], ['list', '#/orders', 'Commandes'], ['plus', '#/new', 'Facture'], ['truck', '#/deliveries', 'Livraisons'], ['more', '#/more', 'Plus']];
  $('#nav').innerHTML = items.map(([k, h, t]) => k === 'plus'
    ? `<a href="${h}" class="plus ${active === k ? 'on' : ''}"><span class="round">${icon('plus', 3)}</span>${t}</a>`
    : `<a href="${h}" class="${active === k ? 'on' : ''}">${icon(k)}${t}</a>`).join('');
  $('#nav').classList.toggle('hidden', active === 'none');
}

function setTop({ title, back, right = '' }) {
  const logo = !back ? `<img class="logo" src="icons/icon-192.png" alt="">` : '';
  $('#top').innerHTML = `${back ? `<button class="back" data-back="${back}" aria-label="Retour">←</button>` : ''}${logo}<div class="title">${esc(title)}</div>${right}`;
  const b = $('[data-back]', $('#top'));
  if (b) b.onclick = () => { location.hash = b.dataset.back; };
}

function view(html) { const v = $('#view'); v.innerHTML = html; window.scrollTo(0, 0); return v; }

let toastTimer;
function toast(msg, err = false) {
  const t = $('#toast');
  t.textContent = msg; t.className = 'show' + (err ? ' err' : '');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.className = ''; }, 2600);
}

function ask({ title, text = '', ok = 'Confirmer', cancel = 'Annuler', danger = false, body = '', onOpen = null }) {
  return new Promise((resolve) => {
    const bg = document.createElement('div');
    bg.className = 'modal-bg';
    bg.innerHTML = `<div class="modal"><h3>${esc(title)}</h3>${text ? `<p>${esc(text)}</p>` : ''}${body}
      <div class="btns" style="margin-top:12px"><button class="btn ghost" data-r="0">${esc(cancel)}</button>
      <button class="btn ${danger ? 'danger' : 'primary'}" data-r="1">${esc(ok)}</button></div></div>`;
    document.body.appendChild(bg);
    if (onOpen) onOpen(bg);
    bg.addEventListener('click', (e) => {
      const r = e.target.closest('[data-r]');
      if (e.target === bg || r) {
        const val = r && r.dataset.r === '1' ? (body ? bg : true) : false;
        resolve(val); setTimeout(() => bg.remove(), 0);
      }
    });
  });
}

function showImage(src) {
  const bg = document.createElement('div');
  bg.className = 'modal-bg';
  bg.style.alignItems = 'center';
  bg.innerHTML = `<div style="padding:14px;max-width:600px;width:100%"><img class="photo-full" src="${src}"></div>`;
  bg.onclick = () => bg.remove();
  document.body.appendChild(bg);
}

function badge(o) { return `<span class="badge ${STATUS_TONE[o.status]}">${STATUS_LABEL[o.status]}</span>`; }

function steps(o) {
  const done = o.status === STATUS.LIVRE;
  return `<div class="steps ${done ? 'done' : ''}">${[0, 1, 2, 3, 4, 5].map((i) => `<i class="${i <= o.status ? 'on' : ''}"></i>`).join('')}</div>`;
}

async function busy(btn, fn) {
  const label = btn.innerHTML;
  btn.disabled = true; btn.innerHTML = '…';
  try { return await fn(); }
  catch (e) { console.error(e); toast(e.message || 'Erreur', true); }
  finally { btn.disabled = false; btn.innerHTML = label; }
}

function fileSafe(s) { return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, ''); }

// ---------------------------------------------------------------- carte de commande (liste)
function lateBadge(o) {
  const l = L.lateness(o);
  if (l === 'late') return `<span class="badge red">⏰ En retard</span>`;
  if (l === 'soon') return `<span class="badge orange">⏰ ${fmtShort(L.dueDate(o))}</span>`;
  return '';
}
function payBadge(t) {
  if (t.due <= 0) return '';
  return t.paid > 0 ? ` <span class="badge orange">reste ${money(t.due)}</span>` : ' <span class="badge red">impayé</span>';
}
function orderCard(o, { showAction = true } = {}) {
  const t = orderTotals(o);
  const act = L.nextAction(o);
  const late = L.lateness(o) === 'late';
  return `<div class="card edge ${late ? 'late' : STATUS_TONE[o.status]}">
    <div class="row between"><a href="#/order/${o.number}" style="text-decoration:none;color:inherit" class="grow"><b>N°${o.number} · ${esc(o.clientName)}</b></a>${badge(o)}</div>
    ${steps(o)}
    <div class="small muted">${esc(L.itemsSummary(o))}</div>
    <div class="row between" style="margin-top:6px;flex-wrap:wrap;gap:6px"><span class="small">${t.pieces} pièce(s) ${lateBadge(o)}</span>
      <b>${money(t.total)}${payBadge(t)}</b></div>
    ${showAction ? `<div class="btns" style="margin-top:10px">
      ${act ? `<button class="btn primary sm" data-act="${o.number}">${esc(act.label)}</button>` : '<span></span>'}
      <a class="btn sm" href="#/order/${o.number}">Facture</a></div>` : ''}
  </div>`;
}

// Exécute l'action principale d'une commande (depuis une liste ou la fiche).
async function runAction(number, after) {
  const o = await L.getOrder(number);
  const act = L.nextAction(o);
  if (!act) return;
  if (act.kind === 'verify') { location.hash = `#/verify/${o.number}/${act.stage}`; return; }
  if (act.kind === 'deliver') { await deliverFlow(o); after && after(); return; }
  await L.advance(o, act.to);
  toast(`N°${o.number} : ${STATUS_LABEL[act.to]}`);
  after && after();
}

async function deliverFlow(o, cashedChecked = null) {
  const t = orderTotals(o);
  let cash = t.due <= 0;
  if (t.due > 0) {
    if (cashedChecked === null) {
      const m = await ask({
        title: `Livrer la commande N°${o.number} ?`, ok: 'Livré',
        body: `<p>Total ${money(t.total)}${t.paid ? ` · déjà payé ${money(t.paid)}` : ''}<br>Reste à encaisser : <b>${money(t.due)}</b></p>
          <label class="check"><input type="checkbox" id="m-paid"> ${money(t.due)} encaissés</label>`,
      });
      if (!m) return false;
      cash = $('#m-paid', m).checked;
    } else cash = cashedChecked;
    if (!cash && !(await ask({ title: 'Pas encore payé ?', text: `La commande sera livrée mais ${money(t.due)} resteront dans les impayés.`, ok: 'Livrer quand même' }))) return false;
    if (cash) await L.addPayment(o, t.due, 'À la livraison');
  }
  await L.advance(o, STATUS.LIVRE, cash ? '' : 'Livré non soldé');
  toast(`N°${o.number} livrée`);
  await offerThanks(o);
  return true;
}

// Message « vos habits sont prêts » (Monsieur/Madame selon la fiche) et carte de remerciement.
function waReady(o) { return L.readyMessage(o, REG, S); }
function openWa(o, text) { return waOpen(o.clientPhone, text, S); }
async function sendThanks(o, withCard = true) {
  const orders = await db.all('orders');
  const renewed = orders.filter((x) => x.clientId && x.clientId === o.clientId).length > 1;
  const text = L.thanksMessage(o, REG, S, renewed);
  if (!withCard) return openWa(o, text);
  const blob = await thanksCard({ s: S, civ: L.civility(o.clientSex), name: L.lastNameOf(o, REG), renewed });
  const r = await waSendImage(blob, `Merci-${o.number}.png`, o.clientPhone, text, S);
  if (r !== 'cancelled') { o.thanksSentAt = L.nowIso(); await L.saveOrder(o); }
  return r;
}
async function offerThanks(o) {
  if (!o.clientPhone) return;
  const m = await ask({ title: 'Envoyer la carte de remerciement ?', ok: '💌 Carte + message', cancel: 'Plus tard',
    body: `<p>Par WhatsApp à ${esc(o.clientName)}.</p><button class="btn ghost block" id="m-txt" type="button">Message seul (sans image)</button>`,
    onOpen: (bg) => { $('#m-txt', bg).onclick = () => { bg.remove(); sendThanks(o, false); }; } });
  if (m) await sendThanks(o, true);
}

// ---------------------------------------------------------------- bilan mensuel automatique
async function reportBlob(p, fmt) {
  const b = L.computeBilan(await db.all('orders'), await db.all('expenses'), p, S);
  return fmt === 'pdf' ? bilanPdf(b, p, S) : bilanXlsx(b, p, S);
}
// Android : range une copie PDF + Excel dans Documents/SmartPressing/Bilans (une seule fois par période).
async function archiveReports(reports) {
  if (!isNative) return;
  for (const p of reports) {
    const k = 'reportArchived:' + L.reportKey(p);
    if (await db.kv(k)) continue;
    try {
      for (const fmt of ['pdf', 'xlsx']) await saveFile(await reportBlob(p, fmt), bilanFileName(p, fmt), { folder: 'SmartPressing/Bilans', silent: true });
      await db.kv(k, L.nowIso());
      toast(`📊 Bilan ${p.label} rangé dans Documents`);
    } catch (e) { console.warn(e); }
  }
}

// ---------------------------------------------------------------- écrans
const routes = {};

routes.welcome = async () => {
  setNav('none');
  setTop({ title: 'Premier démarrage' });
  const v = view(`<div class="welcome">
    <h1>Vos données</h1>
    <p class="muted">Toutes vos données restent dans ce téléphone.<br>Pas besoin d'internet.</p></div>
    <div class="card stack">
      <button class="btn primary big block" id="w-hist">Reprendre mes données</button>
      <p class="small muted" style="margin:0">Réglages et grille de ${SEED.articles.length} articles${SEED.orders.length ? ` + les factures déjà émises (N°${SEED.orders.map((o) => o.number).join(', N°')})` : ''}.</p>
      <button class="btn ghost block" id="w-empty">Démarrer avec seulement la grille de prix</button>
      <label class="btn ghost block">Restaurer une sauvegarde (fichier)…<input type="file" accept=".json,application/json,text/plain" id="w-file" hidden></label>
      <a class="btn ghost block" href="#/cloud">☁️ Restaurer depuis internet</a>
    </div>`);
  $('#w-hist', v).onclick = async () => { await L.initialize(true); location.hash = '#/home'; boot(); };
  $('#w-empty', v).onclick = async () => { await L.initialize(false); location.hash = '#/home'; boot(); };
  $('#w-file', v).onchange = (e) => restoreFrom(e.target.files[0]);
};

routes.login = async () => {
  setNav('none');
  $('#top').classList.add('hidden');
  document.body.classList.add('white');
  const v = view(`<div class="login">
      ${S.logo ? `<img class="login-logo" src="${S.logo}" alt="">` : '<div class="mark">SP</div>'}
      <p class="login-hello">Bienvenue</p>
      ${S.logo ? '' : `<h1>${esc(S.name || 'Smart Pressing')}</h1>`}
      <p class="muted">${esc(S.city || 'Gestion de pressing')}</p>
      <button class="btn primary big block" id="l-go">Se connecter</button>
    </div>`);
  $('#l-go', v).onclick = () => {
    connected = true;
    $('#top').classList.remove('hidden');
    document.body.classList.remove('white');
    const h = location.hash.replace(/^#\/?/, '');
    if (!h || h.startsWith('login')) location.hash = '#/home'; else render();
  };
};

routes.home = async () => {
  setNav('home');
  const lockBtn = S.adminPin ? `<button class="pill" id="lockbtn">${unlocked ? 'Admin ✓' : 'Admin'}</button>` : '';
  setTop({ title: S.name || 'Smart Pressing', right: lockBtn });
  if ($('#lockbtn')) $('#lockbtn').onclick = () => { if (unlocked) { unlocked = false; toast('Mode admin verrouillé'); render(); } else location.hash = '#/unlock?next=home'; };
  const c = await L.counts();
  const last = await db.kv('lastBackup');
  const total = await db.count('orders');
  let backupNote = '';
  const cloudCfg = await Cloud.getCloud();
  const cloudOkAt = await db.kv('cloudLastOk');
  if (cloudCfg.enabled) {
    const h = cloudOkAt ? (Date.now() - new Date(cloudOkAt).getTime()) / 3600e3 : 999;
    if (h > 48) backupNote = `<a href="#/backup" class="note" style="display:block;text-decoration:none;margin-bottom:12px">⚠️ La sauvegarde en ligne n'est pas passée depuis ${cloudOkAt ? Math.floor(h / 24) + ' jours' : 'son activation'}. Ouvrez l'appli avec internet ou vérifiez la configuration.</a>`;
  } else if (total > 0) {
    const days = last ? Math.floor((Date.now() - new Date(last).getTime()) / 864e5) : null;
    if (days === null || days >= 7) backupNote = `<a href="#/backup" class="note" style="display:block;text-decoration:none;margin-bottom:12px">⚠️ ${days === null ? 'Aucune sauvegarde faite.' : `Dernière sauvegarde il y a ${days} jours.`} Toutes les données sont dans ce téléphone : faites une sauvegarde.</a>`;
  }
  const reports = await L.pendingReports(S);
  const reportCards = reports.map((p) => isAdmin()
    ? `<div class="card report" data-rk="${p.kind}:${p.offset}"><div class="row between"><b>📊 Bilan ${p.kind === 'year' ? 'de l’' + p.label.toLowerCase() : 'de ' + p.label.toLowerCase()} prêt</b><button class="x" data-mr="later" aria-label="Plus tard">✕</button></div>
        <p class="small muted" style="margin:4px 0 10px">${isNative ? 'Une copie est rangée dans Documents/SmartPressing/Bilans. ' : ''}Envoyez-le en un toucher (WhatsApp, e-mail…).</p>
        <div class="btns three"><button class="btn navy sm" data-mr="pdf">PDF</button><button class="btn green sm" data-mr="xlsx">Excel</button><button class="btn sm" data-mr="view">Voir</button></div>
        <button class="btn sm ghost block" data-mr="done" style="margin-top:8px">C'est fait, ne plus afficher</button></div>`
    : `<a href="#/unlock?next=home" class="note" style="display:block;text-decoration:none;margin-bottom:12px">📊 Le bilan ${p.kind === 'year' ? 'de l’année' : 'du mois'} est prêt (mode admin).</a>`).join('');
  const now = new Date();
  const hello = now.getHours() < 18 ? 'Bonjour' : 'Bonsoir';
  const hv = view(`<h1>${hello} 👋</h1>
    <p class="muted" style="margin:4px 0 14px">${fmtDate(L.todayIso(), false)} · ${c.open} commande(s) en cours</p>
    ${backupNote}
    ${reportCards}
    <a class="btn primary big block" href="#/new" style="margin-bottom:14px">+ Nouvelle facture</a>
    ${c.late.length ? `<div class="card edge late"><b style="color:var(--red)">⏰ ${c.late.length} commande(s) en retard</b>${c.late.slice(0, 6).map((o) => `<a class="late-row" href="#/order/${o.number}"><span>N°${o.number} · ${esc(o.clientName)}</span><span>promis ${fmtShort(L.dueDate(o))}</span></a>`).join('')}</div>` : ''}
    ${c.soon.length ? `<div class="card edge orange"><b style="color:#a65200">À rendre dans les 24 h : ${c.soon.length}</b>${c.soon.slice(0, 6).map((o) => `<a class="late-row" href="#/order/${o.number}"><span>N°${o.number} · ${esc(o.clientName)} · ${STATUS_LABEL[o.status]}</span><span>${fmtShort(L.dueDate(o))}</span></a>`).join('')}</div>` : ''}
    <div class="tiles">
      <a class="tile orange" href="#/orders?s=0"><b>${c.byStatus[0]}</b><span>À envoyer au cousin</span></a>
      <a class="tile blue" href="#/orders?s=1"><b>${c.byStatus[1]}</b><span>Chez le cousin</span></a>
      <a class="tile orange" href="#/ironing"><b>${c.byStatus[2]}</b><span>À repasser</span></a>
      <a class="tile orange" href="#/orders?s=3"><b>${c.byStatus[3]}</b><span>À vérifier</span></a>
      <a class="tile green" href="#/deliveries"><b>${c.byStatus[4]}</b><span>Prêtes</span></a>
      <a class="tile navy" href="#/orders?s=today"><b>${c.todayCount}</b><span>Factures du jour</span></a>
      ${c.claims ? `<a class="tile red wide" href="#/claims"><b>${c.claims}</b><span>Réclamation(s) à régler</span></a>` : ''}
      ${isAdmin() ? `<a class="tile navy wide" href="#/bilan"><b>${money(c.todayCA)}</b><span>Chiffre d'affaires du jour</span></a>` : ''}
    </div>`);
  $$('.report', hv).forEach((card) => {
    const [kind, off] = card.dataset.rk.split(':');
    const p = L.period(kind, Number(off));
    card.onclick = async (e) => {
      const b = e.target.closest('[data-mr]'); if (!b) return;
      const act = b.dataset.mr;
      if (act === 'later') { await db.kv('reportSnooze', L.todayIso()); toast('Rappel demain'); return routes.home(); }
      if (act === 'done') { await db.kv('reportDone:' + L.reportKey(p), true); return routes.home(); }
      if (act === 'view') { location.hash = `#/bilan?k=${kind}&o=${off}`; return; }
      await busy(b, async () => {
        const blob = await reportBlob(p, act);
        const r = await shareFile(blob, bilanFileName(p, act), 'Bilan ' + p.label);
        if (r !== 'cancelled') { await db.kv('reportSent:' + L.reportKey(p), L.nowIso()); toast('Bilan envoyé'); }
      });
    };
  });
  archiveReports(reports);
};

routes.new = async (_, q) => {
  setNav('plus');
  const number = await L.nextNumber();
  setTop({ title: 'Nouvelle facture', right: `<span class="pill">N°${number}</span>` });
  const arts = await L.getArticles(true);
  const orders = await db.all('orders');
  const reg = await L.getClientsReg();
  const stats = L.clientsWithStats(reg, orders);
  const promos = (await L.getPromos()).filter((p) => L.promoActiveNow(p));
  const qty = {};
  let client = null;                 // fiche choisie
  let known = { fiche: 0, invoices: [] };
  let loyaltyOn = true;
  const promoOn = Object.fromEntries(promos.map((p) => [p.id, !!p.auto]));
  const v = view(`<div class="card">
      <label class="f">Client</label>
      <div class="combo"><input class="i" id="n-client" placeholder="Choisir ou écrire un nom…" autocomplete="off" autocapitalize="words"><button class="combo-btn" id="n-open" type="button" aria-label="Liste">▾</button></div>
      <div id="n-list" class="sugg hidden"></div>
      <div id="n-chosen"></div>
      <div id="n-newc" class="hidden stack newc">
        <b class="small" style="color:var(--blue)">Nouveau client : il sera ajouté à vos clients</b>
        <div class="grid2"><div><label class="f">Nom</label><input class="i" id="nc-last" autocapitalize="characters"></div>
          <div><label class="f">Prénom</label><input class="i" id="nc-first" autocapitalize="words"></div></div>
        <div class="seg sex" id="nc-sex"><a data-sex="M">Monsieur</a><a data-sex="F">Madame</a></div>
        <div><label class="f">Numéro WhatsApp</label><input class="i" id="nc-phone" type="tel" inputmode="tel"></div>
      </div></div>
    <div class="card"><label class="f">Lavage</label>
      <div class="seg" id="n-wash"><a class="on" data-w="cousin">🧺 Chez le cousin</a><a data-w="maison">🏠 Lavage maison</a></div>
      <p class="small muted" id="n-washinfo" style="margin:6px 0 0"></p></div>
    <div class="card" id="n-arts">${arts.map((a) => `<div class="art" data-id="${a.id}">
        <div class="name">${esc(a.name)}<div class="price">${money(a.price)}${a.homeWash ? ' · lavage maison' : ''}</div></div>
        <div class="qty"><button class="minus" data-d="-1">−</button><output>0</output><button class="plus" data-d="1">+</button></div></div>`).join('') || '<div class="empty">Aucun article actif : ajoutez-en dans Réglages.</div>'}</div>
    <div class="card stack">
      <div><label class="f">À rendre le</label><input class="i" id="n-due" type="datetime-local" value="${L.defaultDue(S.dueDays)}"></div>
      <div id="n-kgbox"><label class="f">Poids pesé (kg) — facultatif</label><input class="i" id="n-kg" type="number" inputmode="decimal" step="0.1" min="0" placeholder="estimé : 0 kg"></div>
      <label class="check"><input type="checkbox" id="n-deliv"> Livraison (+${money(S.deliveryFee)})</label>
      <div id="n-dbox" class="hidden stack">
        <div><label class="f">Lieu de livraison</label><input class="i" id="n-place"></div>
        <div><label class="f">Date et heure de livraison</label><input class="i" id="n-at" type="datetime-local"></div>
      </div>
      <div id="n-promos"></div>
      <div id="n-arrbox">
        <button class="btn sm ghost" id="n-arr-add" type="button">+ Ajouter un arriéré (ancien solde)</button>
        <div id="n-arr" class="hidden stack arr"></div>
      </div>
      <div class="grid2">
        <div><label class="f">Remise libre (F)</label><input class="i" id="n-disc" type="number" inputmode="numeric" min="0" placeholder="0"></div>
        <div><label class="f">Payé maintenant (F)</label><input class="i" id="n-dep" type="number" inputmode="numeric" min="0" placeholder="0 = rien"></div>
      </div>
      <div class="row" style="gap:6px"><button class="btn sm ghost" id="n-full" type="button">Tout payé</button><span class="small muted" id="n-rest"></span></div>
    </div>
    <div class="totalbar">
      <div class="row between"><span>À payer</span><span class="big" id="n-total">0 F</span></div>
      <div class="small" id="n-admin" style="opacity:.85"></div>
      <button class="btn primary big block" id="n-go" style="margin-top:10px">Émettre la facture</button>
    </div>`);
  const washMode = () => $('#n-wash .on', v).dataset.w;
  let arrOpen = false;
  const arrState = { fiche: false, inv: {}, other: 0, note: '' };
  const lines = () => arts.filter((a) => qty[a.id] > 0).map((a) => ({ articleId: a.id, qty: qty[a.id], price: a.price }));
  const sums = () => {
    let items = 0, est = 0, n = 0;
    const home = washMode() === 'maison';
    for (const a of arts) { const q2 = qty[a.id] || 0; items += q2 * a.price; if (!a.homeWash && !home) est += q2 * a.weight; n += q2; }
    const deliv = $('#n-deliv', v).checked ? Number(S.deliveryFee) || 0 : 0;
    const cs = client && stats.find((x) => x.id === client.id);
    const reward = cs ? L.loyaltyReward(S, cs.orders.length, items) : null;
    const loyal = reward && loyaltyOn ? reward.amount : 0;
    const ls = lines();
    const promoList = promos.map((p) => ({ p, amount: L.promoAmount(p, ls, items) })).filter((x) => x.amount > 0);
    const promoSum = promoList.filter((x) => promoOn[x.p.id]).reduce((a, x) => a + x.amount, 0);
    const manual = Math.max(0, Math.round(Number($('#n-disc', v).value) || 0));
    const discount = Math.min(items + deliv, loyal + promoSum + manual);
    const arrFiche = arrOpen && arrState.fiche ? known.fiche : 0;
    const arrInv = arrOpen ? known.invoices.filter((x) => arrState.inv[x.number]).reduce((a, x) => a + x.due, 0) : 0;
    const arrOther = arrOpen ? Math.max(0, Math.round(arrState.other || 0)) : 0;
    const arrears = arrFiche + arrInv + arrOther;
    const sales = items + deliv - discount;
    return { items, est, n, deliv, reward, loyal, promoList, promoSum, manual, discount, sales, arrFiche, arrInv, arrOther, arrears, total: sales + arrears };
  };
  const drawPromos = (s) => {
    const html = s.promoList.map((x) => `<label class="check loyal"><input type="checkbox" data-promo="${x.p.id}" ${promoOn[x.p.id] ? 'checked' : ''}> 🏷️ ${esc(x.p.name)} : −${money(x.amount)}</label>`).join('')
      + (s.reward ? `<label class="check loyal"><input type="checkbox" id="n-loyal-on" ${loyaltyOn ? 'checked' : ''}> 🎁 ${esc(s.reward.label)} : −${money(s.reward.amount)}</label>` : '');
    const box = $('#n-promos', v);
    if (box.dataset.h !== html) { box.innerHTML = html; box.dataset.h = html; }
  };
  const drawArrears = () => {
    const box = $('#n-arr', v);
    $('#n-arr-add', v).classList.toggle('hidden', arrOpen);
    box.classList.toggle('hidden', !arrOpen);
    if (!arrOpen) return;
    const opts = [];
    if (known.fiche > 0) opts.push(`<label class="check"><input type="checkbox" data-arr="fiche" ${arrState.fiche ? 'checked' : ''}> Ancien solde de la fiche : <b>${money(known.fiche)}</b></label>`);
    for (const x of known.invoices) opts.push(`<label class="check"><input type="checkbox" data-arr="inv" data-n="${x.number}" ${arrState.inv[x.number] ? 'checked' : ''}> Reste de la facture N°${x.number} : <b>${money(x.due)}</b></label>`);
    box.innerHTML = `<div class="row between"><b>Arriéré</b><button class="btn sm ghost" id="n-arr-x" type="button">Retirer</button></div>
      ${client ? (opts.length ? `<p class="small muted" style="margin:0">Montants connus pour ce client :</p>${opts.join('')}` : '<p class="small muted" style="margin:0">Aucun ancien solde connu pour ce client.</p>') : '<p class="small muted" style="margin:0">Choisissez d’abord le client pour voir ses montants connus.</p>'}
      <div class="grid2"><div><label class="f">Autre montant (F)</label><input class="i" id="n-arr-other" type="number" inputmode="numeric" min="0" value="${arrState.other || ''}" placeholder="0"></div>
        <div><label class="f">Note</label><input class="i" id="n-arr-note" value="${esc(arrState.note)}" placeholder="ex. facture papier n°45"></div></div>`;
    $('#n-arr-x', v).onclick = () => { arrOpen = false; drawArrears(); recalc(); };
    $$('[data-arr]', box).forEach((cb) => { cb.onchange = () => {
      if (cb.dataset.arr === 'fiche') arrState.fiche = cb.checked; else arrState.inv[cb.dataset.n] = cb.checked;
      recalc();
    }; });
    $('#n-arr-other', v).oninput = (e) => { arrState.other = Number(e.target.value) || 0; recalc(); };
    $('#n-arr-note', v).oninput = (e) => { arrState.note = e.target.value; };
  };
  const recalc = () => {
    const s = sums();
    const kgv = $('#n-kg', v).value;
    const home = washMode() === 'maison';
    const washKg = home ? 0 : kgv !== '' ? Number(kgv) : s.est;
    const wash = Math.round(washKg * S.cousinRate);
    $('#n-kg', v).placeholder = `estimé : ${L.kg(s.est)}`;
    $('#n-kgbox', v).classList.toggle('hidden', home);
    $('#n-washinfo', v).textContent = home ? 'Rien n’ira chez le cousin : pas de coût de lavage, pas de vérification au retour.' : 'Les articles « lavage maison » restent ici ; le reste part chez le cousin.';
    $('#n-total', v).textContent = money(s.total);
    $('#n-admin', v).textContent = [s.n ? `${s.n} pièce(s)` : '', s.discount ? `remise ${money(s.discount)}` : '', s.arrears ? `dont arriéré ${money(s.arrears)}` : '',
      isAdmin() && s.n ? `lavage ${money(wash)} · marge ${money(s.sales - wash)}` : ''].filter(Boolean).join(' · ');
    drawPromos(s);
    const dep = Math.round(Number($('#n-dep', v).value) || 0);
    $('#n-rest', v).textContent = s.total ? (dep >= s.total ? 'Facture soldée' : dep > 0 ? `Reste à payer : ${money(s.total - dep)}` : 'Rien payé pour l’instant') : '';
  };
  $('#n-promos', v).addEventListener('change', (e) => {
    if (e.target.id === 'n-loyal-on') loyaltyOn = e.target.checked;
    if (e.target.dataset.promo) promoOn[e.target.dataset.promo] = e.target.checked;
    recalc();
  });
  // --- client : liste déroulante / nouveau client
  const sorted = stats.slice().sort((a, b) => a.name.localeCompare(b.name));
  const showList = (text) => {
    const t = (text || '').trim().toLowerCase(), d = t.replace(/\D/g, '');
    const list = sorted.filter((c) => !t || c.name.toLowerCase().includes(t) || (c.firstName || '').toLowerCase().includes(t) || (d.length >= 3 && (c.phone || '').replace(/\D/g, '').includes(d))).slice(0, 60);
    const box = $('#n-list', v);
    box.innerHTML = list.map((c) => `<button type="button" data-cid="${c.id}"><b>${esc(c.name)}</b> <span class="muted">${esc(c.phone || '')}${c.orders.length ? ` · ${c.orders.length} cmd` : ''}</span></button>`).join('')
      + (t ? `<button type="button" data-cid="new" class="newbtn">➕ Nouveau client « ${esc(text.trim())} »</button>` : '')
      + (!list.length && !t ? '<div class="small muted" style="padding:10px">Aucun client enregistré : écrivez un nom.</div>' : '');
    box.classList.remove('hidden');
  };
  const choose = async (c) => {
    client = c; $('#n-list', v).classList.add('hidden'); $('#n-newc', v).classList.add('hidden');
    const cs = stats.find((x) => x.id === c.id) || { orders: [], spent: 0, due: 0 };
    known = await L.knownArrears(c.id);
    const lp = L.loyaltyProgress(S, cs.orders.length);
    $('#n-client', v).value = L.clientDisplay(c);
    $('#n-chosen', v).innerHTML = `<div class="client-chip"><b>${esc(L.civility(c.sex))} ${esc(L.clientDisplay(c))}</b>${c.phone ? ' · ' + esc(c.phone) : ''}
      <br>${cs.orders.length ? `${cs.orders.length} commande(s) · ${money(cs.spent)} dépensés` : 'Aucune commande encore'}${cs.due + (c.arrears || 0) > 0 ? ` · <span style="color:var(--red)">doit ${money(cs.due + (c.arrears || 0))}</span>` : ''}
      ${lp ? `<br><span class="small">Fidélité : ${lp.left === 0 ? 'cette commande est récompensée 🎁' : `récompense dans ${lp.left + 1} commande(s)`}</span>` : ''}
      <br><a href="#" id="n-change" class="small">Changer de client</a></div>`;
    $('#n-change', v).onclick = (e) => { e.preventDefault(); client = null; known = { fiche: 0, invoices: [] }; $('#n-chosen', v).innerHTML = ''; $('#n-client', v).value = ''; $('#n-client', v).focus(); showList(''); drawArrears(); recalc(); };
    if (cs.due + (c.arrears || 0) > 0 && !arrOpen) { arrOpen = true; }
    drawArrears(); recalc();
  };
  const startNew = (text) => {
    client = null; known = { fiche: 0, invoices: [] };
    $('#n-list', v).classList.add('hidden'); $('#n-chosen', v).innerHTML = '';
    const parts = text.trim().split(/\s+/);
    $('#nc-last', v).value = (parts[0] || '').toUpperCase(); $('#nc-first', v).value = parts.slice(1).join(' ');
    $('#n-newc', v).classList.remove('hidden'); drawArrears(); recalc();
  };
  $('#n-client', v).oninput = (e) => { client = null; $('#n-chosen', v).innerHTML = ''; showList(e.target.value); };
  $('#n-client', v).onfocus = (e) => { if (!client) showList(e.target.value); };
  $('#n-open', v).onclick = () => { const box = $('#n-list', v); if (box.classList.contains('hidden')) showList(client ? '' : $('#n-client', v).value); else box.classList.add('hidden'); };
  $('#n-list', v).onclick = (e) => {
    const b = e.target.closest('[data-cid]'); if (!b) return;
    if (b.dataset.cid === 'new') startNew($('#n-client', v).value);
    else choose(reg.find((c) => c.id === Number(b.dataset.cid)));
  };
  $('#nc-sex', v).onclick = (e) => { const a = e.target.closest('[data-sex]'); if (!a) return; $$('#nc-sex a', v).forEach((x) => x.classList.toggle('on', x === a)); };
  // --- reste du formulaire
  $('#n-wash', v).onclick = (e) => { const a = e.target.closest('[data-w]'); if (!a) return; $$('#n-wash a', v).forEach((x) => x.classList.toggle('on', x === a)); recalc(); };
  $('#n-arr-add', v).onclick = () => { arrOpen = true; drawArrears(); recalc(); };
  $('#n-arts', v).addEventListener('click', (e) => {
    const b = e.target.closest('button[data-d]'); if (!b) return;
    const row = b.closest('.art'); const id = Number(row.dataset.id);
    qty[id] = Math.max(0, (qty[id] || 0) + Number(b.dataset.d));
    $('output', row).textContent = qty[id];
    row.classList.toggle('on', qty[id] > 0);
    recalc();
  });
  ['#n-kg', '#n-disc', '#n-dep'].forEach((id) => { $(id, v).oninput = recalc; });
  $('#n-full', v).onclick = () => { $('#n-dep', v).value = sums().total; recalc(); };
  $('#n-deliv', v).onchange = () => { $('#n-dbox', v).classList.toggle('hidden', !$('#n-deliv', v).checked); recalc(); };
  $('#n-at', v).onchange = () => { if ($('#n-at', v).value) $('#n-due', v).value = $('#n-at', v).value; };
  $('#n-go', v).onclick = (e) => busy(e.currentTarget, async () => {
    let c = client;
    if (!c) {
      if ($('#n-newc', v).classList.contains('hidden')) {
        if ($('#n-client', v).value.trim()) { startNew($('#n-client', v).value); throw new Error('Complétez la fiche du nouveau client.'); }
        throw new Error('Choisissez le client.');
      }
      const sexA = $('#nc-sex a.on', v);
      if (!sexA) throw new Error('Choisissez Monsieur ou Madame.');
      c = await L.saveClient({ lastName: $('#nc-last', v).value, firstName: $('#nc-first', v).value, sex: sexA.dataset.sex, phone: $('#nc-phone', v).value });
    }
    const s = sums();
    const labels = [...s.promoList.filter((x) => promoOn[x.p.id]).map((x) => x.p.name), ...(s.loyal ? [s.reward.label] : []), ...(s.manual ? ['Remise'] : [])];
    const arrNotes = [s.arrFiche ? 'ancien solde' : '', ...known.invoices.filter((x) => arrOpen && arrState.inv[x.number]).map((x) => `reste N°${x.number}`), s.arrOther ? (arrState.note.trim() || 'autre') : ''].filter(Boolean);
    const o = await L.createOrder({
      clientId: c.id, clientSex: c.sex, clientName: L.clientDisplay(c), clientPhone: c.phone, quantities: qty,
      weighedKg: washMode() === 'maison' ? '' : $('#n-kg', v).value, delivery: $('#n-deliv', v).checked,
      deliveryPlace: $('#n-place', v).value, deliveryAt: $('#n-at', v).value, dueAt: $('#n-due', v).value,
      discount: s.discount ? { amount: s.discount, label: labels.join(' + ') } : null,
      arrears: s.arrears ? { amount: s.arrears, note: arrNotes.join(', ') } : null,
      homeOnly: washMode() === 'maison', deposit: $('#n-dep', v).value,
    });
    if (s.arrears) await L.applyArrears(o, { fromFiche: s.arrFiche, fromInvoices: known.invoices.filter((x) => arrState.inv[x.number]).map((x) => x.number) });
    toast(`Facture N°${o.number} émise`);
    location.hash = `#/order/${o.number}`;
  });
  if (q.get('cid')) { const c = reg.find((x) => x.id === Number(q.get('cid'))); if (c) await choose(c); }
  drawArrears();
  recalc();
};

routes.order = async (number) => {
  setNav('list');
  const o = await L.getOrder(number);
  if (!o) { setTop({ title: 'Introuvable', back: '#/orders' }); view('<div class="empty">Cette facture n’existe pas.</div>'); return; }
  setTop({ title: `Facture N°${o.number}`, back: '#/orders', right: badge(o) });
  const t = orderTotals(o);
  const act = L.nextAction(o);
  const photos = {};
  for (const p of o.pieces) photos[p.index] = await L.getPhoto(pieceCode(o.number, p.index));
  const claims = o.claims || [];
  const ready = o.status === STATUS.PRET && o.clientPhone;
  const due = L.dueDate(o);
  const v = view(`
    ${ready ? `<button class="btn wa big block" id="o-ready" style="margin-bottom:10px">📲 Prévenir : « votre linge est prêt »</button>` : ''}
    ${act ? `<button class="btn primary big block" id="o-act" style="margin-bottom:12px">${esc(act.label)}</button>` : ''}
    ${L.lateness(o) === 'late' ? `<div class="alert" style="margin-bottom:12px">⏰ En retard : promis pour le ${fmtShort(due)}.</div>` : ''}
    <div class="card">
      <div class="row between"><div><a href="${o.clientId ? '#/client/' + o.clientId : '#/clients'}" style="color:inherit;text-decoration:none"><b style="font-size:1.1rem">${esc(o.clientName)} ›</b></a>
        <div class="small muted">${o.clientPhone ? `<a href="tel:${esc(o.clientPhone)}">${esc(o.clientPhone)}</a> · ` : ''}${fmtDate(o.createdAt)}</div></div>
        <span class="badge ${t.due <= 0 ? (t.transferred && t.paid < t.total ? 'blue' : 'green') : t.paid ? 'orange' : 'red'}">${t.due <= 0 ? (t.transferred && t.paid < t.total ? 'Reportée' : 'Payé') : t.paid ? 'Acompte' : 'Impayé'}</span></div>
      ${steps(o)}
      <div class="inv-lines">
        ${o.items.map((i) => `<div class="l"><span>${i.qty} × ${esc(i.name)}</span><span>${money(i.qty * i.price)}</span></div>`).join('')}
        ${o.deliveryFee ? `<div class="l"><span>Livraison</span><span>${money(o.deliveryFee)}</span></div>` : ''}
        ${t.discount ? `<div class="l"><span>${esc((o.discount && o.discount.label) || 'Remise')}</span><span>− ${money(t.discount)}</span></div>` : ''}
        ${t.arrears ? `<div class="l"><span>Arriéré${o.arrears.note ? ' (' + esc(o.arrears.note) + ')' : ''}</span><span>${money(t.arrears)}</span></div>` : ''}
        <div class="l total"><span>Total</span><span>${money(t.total)}</span></div>
        ${t.paid > 0 && t.due > 0 ? `<div class="l"><span>Déjà payé</span><span>${money(t.paid)}</span></div><div class="l total" style="color:var(--red)"><span>Reste à payer</span><span>${money(t.due)}</span></div>` : ''}
      </div>
      ${due ? `<p class="small" style="margin:6px 0 0">⏰ À rendre le ${fmtShort(due)}</p>` : ''}
      ${o.deliveryPlace || o.deliveryAt ? `<p class="small" style="margin:4px 0 0">🚚 ${esc(o.deliveryPlace || 'Lieu à préciser')}${o.deliveryAt ? ' · ' + fmtShort(o.deliveryAt) : ''}</p>` : ''}
    </div>
    ${o.note ? `<div class="note" style="margin-bottom:12px">Remarque : ${esc(o.note)}</div>` : ''}
    ${(o.transfers || []).map((x) => `<div class="note" style="margin-bottom:12px">↪ Reste de ${money(x.amount)} reporté sur la <a href="#/order/${x.toOrder}">facture N°${x.toOrder}</a>.</div>`).join('')}
    ${o.washMode === 'maison' ? '<p class="small muted" style="margin:-4px 0 10px">🏠 Lavage maison (ne va pas chez le cousin)</p>' : ''}
    ${o.status === STATUS.LIVRE && o.clientPhone ? `<button class="btn wa block" id="o-thanks" style="margin-bottom:12px">💌 ${o.thanksSentAt ? 'Renvoyer' : 'Envoyer'} la carte de remerciement</button>` : ''}
    <div class="btns" style="margin-bottom:12px">
      ${t.due > 0 ? `<button class="btn green" id="o-pay">Encaisser</button>` : ''}
      <button class="btn navy" id="o-share">Envoyer le PDF</button>
      <button class="btn" id="o-ticket">🧾 Ticket 58 mm</button>
      <button class="btn" id="o-dl">Télécharger</button>
      ${o.clientPhone ? `<button class="btn" id="o-wa">WhatsApp</button>` : ''}
      <button class="btn" id="o-claim">⚠️ Réclamation</button>
    </div>
    ${(o.payments || []).length ? `<div class="card"><h2 style="margin-top:0">Paiements</h2><div class="calc">${o.payments.map((p) => `<div class="l"><span>${fmtDate(p.at)}${p.note ? ' · ' + esc(p.note) : ''}</span><span>${money(p.amount)}</span></div>`).join('')}</div>
      ${isAdmin() ? `<button class="btn sm ghost" id="o-unpay" style="margin-top:8px">Annuler les paiements</button>` : ''}</div>` : ''}
    ${claims.length ? `<h2>Réclamations</h2>${claims.map((c) => claimCard(o, c)).join('')}` : ''}
    ${isAdmin() ? `<div class="card"><h2 style="margin-top:0">Coûts (admin)</h2>
      <div class="calc"><div class="l"><span>Poids ${o.weighedKg != null ? 'pesé' : 'estimé'}</span><span>${L.kg(t.washKg)}</span></div>
      <div class="l"><span>Lavage cousin (${money(o.cousinRate)}/kg)</span><span>− ${money(t.wash)}</span></div>
      <div class="l sum"><span>Marge</span><span>${money(t.margin)}</span></div></div>
      <div class="row" style="margin-top:10px"><input class="i grow" id="o-kg" type="number" inputmode="decimal" step="0.1" placeholder="Poids pesé (kg)" value="${o.weighedKg ?? ''}"><button class="btn sm" id="o-kgsave">Enregistrer</button></div>
    </div>` : ''}
    <h2>Photos des pièces</h2>
    <div class="card">${o.pieces.map((p) => {
      const ph = photos[p.index];
      return `<div class="piece">${ph ? `<img class="thumb" src="${ph}" data-full="${p.index}">` : '<div class="thumb">—</div>'}
        <div class="grow"><b>${esc(p.name)}</b><div class="small muted">Pièce ${p.index}/${o.pieces.length}${p.homeWash ? ' · maison' : ''}</div></div>
        <label class="btn sm">${ph ? 'Refaire' : 'Photo'}<input type="file" accept="image/*" capture="environment" data-photo="${p.index}" hidden></label></div>`;
    }).join('')}</div>
    <h2>Historique</h2>
    <div class="card timeline">${o.events.slice().reverse().map((e) => `<div class="ev"><span class="dot"></span><div><b>${esc(e.note && e.status === 0 ? e.note : STATUS_LABEL[e.status])}</b>${e.note && e.status !== 0 ? ' · ' + esc(e.note) : ''}<div class="small muted">${fmtDate(e.at)}</div></div></div>`).join('')}</div>
    ${isAdmin() ? `<button class="btn danger block" id="o-del" style="margin-top:6px">Supprimer cette facture</button>` : ''}
  `);
  const reload = () => routes.order(number);
  if (act) $('#o-act', v).onclick = (e) => busy(e.currentTarget, () => runAction(o.number, reload));
  if ($('#o-ready', v)) $('#o-ready', v).onclick = () => openWa(o, waReady(o));
  if ($('#o-thanks', v)) $('#o-thanks', v).onclick = () => offerThanks(o);
  const pdfName = `Facture-${o.number}-${fileSafe(o.clientName)}.pdf`;
  $('#o-share', v).onclick = (e) => busy(e.currentTarget, async () => {
    const blob = await invoicePdf(o, S);
    const r = await shareFile(blob, pdfName, `Facture N°${o.number}`);
    if (r === 'downloaded' && o.clientPhone) openWa(o, waText(o));
  });
  $('#o-ticket', v).onclick = (e) => busy(e.currentTarget, async () => {
    await shareFile(await ticketPdf(o, S), `Ticket-${o.number}.pdf`, `Ticket N°${o.number}`);
  });
  $('#o-dl', v).onclick = (e) => busy(e.currentTarget, async () => {
    const where = await saveFile(await invoicePdf(o, S), pdfName);
    if (where) toast('Enregistré : ' + where);
  });
  if ($('#o-pay', v)) $('#o-pay', v).onclick = async () => {
    const m = await ask({ title: 'Encaisser', ok: 'Enregistrer',
      body: `<p>Reste à payer : <b>${money(t.due)}</b></p><label class="f">Montant reçu (F)</label><input class="i" id="m-amt" type="number" inputmode="numeric" value="${t.due}">` });
    if (!m) return;
    try { await L.addPayment(o, $('#m-amt', m).value, t.paid ? 'Paiement' : (Number($('#m-amt', m).value) >= t.due ? 'Paiement' : 'Acompte')); toast('Paiement enregistré'); reload(); }
    catch (err) { toast(err.message, true); }
  };
  if ($('#o-unpay', v)) $('#o-unpay', v).onclick = async () => {
    if (!(await ask({ title: 'Annuler tous les paiements ?', text: 'La facture redeviendra impayée.', ok: 'Annuler les paiements', danger: true }))) return;
    await L.clearPayments(o); toast('Paiements annulés'); reload();
  };
  if ($('#o-wa', v)) $('#o-wa', v).onclick = () => openWa(o, o.status === STATUS.PRET ? waReady(o) : waText(o));
  $('#o-claim', v).onclick = () => newClaim(o, reload);
  bindClaims(v, o, reload);
  if ($('#o-kgsave', v)) $('#o-kgsave', v).onclick = async () => {
    const val = $('#o-kg', v).value; o.weighedKg = val === '' ? null : Number(val);
    await L.saveOrder(o); toast('Poids enregistré'); reload();
  };
  $$('[data-full]', v).forEach((img) => { img.onclick = () => showImage(img.src); });
  $$('[data-photo]', v).forEach((inp) => {
    inp.onchange = async () => {
      const f = inp.files[0]; if (!f) return;
      try { await L.savePhoto(pieceCode(o.number, Number(inp.dataset.photo)), await L.resizeImage(f)); toast('Photo enregistrée'); reload(); }
      catch (err) { toast(err.message, true); }
    };
  });
  if ($('#o-del', v)) $('#o-del', v).onclick = async () => {
    if (!(await ask({ title: `Supprimer la facture N°${o.number} ?`, text: 'La facture, ses pièces et ses photos seront effacées définitivement.', ok: 'Supprimer', danger: true }))) return;
    await L.deleteOrder(o); toast('Facture supprimée'); location.hash = '#/orders';
  };
};

// ---------------------------------------------------------------- réclamations
function claimCard(o, c) {
  const piece = c.pieceIndex ? o.pieces.find((p) => p.index === c.pieceIndex) : null;
  return `<div class="card edge ${c.status === 'open' ? 'late' : 'done'}">
    <div class="row between"><b>${esc(L.CLAIM_TYPES[c.type] || c.type)}${piece ? ' · ' + esc(piece.name) + ` (pièce ${piece.index})` : ''}</b>
      <span class="badge ${c.status === 'open' ? 'red' : 'green'}">${c.status === 'open' ? 'Ouverte' : 'Réglée'}</span></div>
    ${c.note ? `<p class="small" style="margin:6px 0">${esc(c.note)}</p>` : ''}
    <div class="small muted">Signalée le ${fmtDate(c.createdAt)}${c.resolvedAt ? ` · réglée le ${fmtDate(c.resolvedAt)}` : ''}</div>
    ${c.resolution || c.compensation ? `<p class="small" style="margin:6px 0 0">✔ ${esc(c.resolution || '')}${c.compensation ? ` · dédommagement ${money(c.compensation)}` : ''}</p>` : ''}
    ${c.status === 'open' ? `<button class="btn sm green" data-resolve="${c.id}" data-order="${o.number}" style="margin-top:8px">Marquer réglée</button>` : ''}
  </div>`;
}
async function newClaim(o, after) {
  const m = await ask({ title: `Réclamation · N°${o.number}`, ok: 'Enregistrer',
    body: `<label class="f">Problème</label><select class="i" id="m-type">${Object.entries(L.CLAIM_TYPES).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select>
      <label class="f" style="margin-top:8px">Pièce concernée</label><select class="i" id="m-piece"><option value="">Toute la commande</option>${o.pieces.map((p) => `<option value="${p.index}">Pièce ${p.index} · ${esc(p.name)}</option>`).join('')}</select>
      <label class="f" style="margin-top:8px">Détail</label><input class="i" id="m-note" placeholder="ex. trou sur la manche gauche">` });
  if (!m) return;
  await L.addClaim(o, { type: $('#m-type', m).value, pieceIndex: Number($('#m-piece', m).value) || null, note: $('#m-note', m).value });
  toast('Réclamation enregistrée'); after && after();
}
function bindClaims(root, o, after) {
  $$('[data-resolve]', root).forEach((b) => {
    b.onclick = async () => {
      const order = o || (await L.getOrder(b.dataset.order));
      const m = await ask({ title: 'Régler la réclamation', ok: 'Marquer réglée',
        body: `<label class="f">Solution</label><input class="i" id="m-res" placeholder="ex. relavée, client satisfait">
          <label class="f" style="margin-top:8px">Dédommagement versé (F) — facultatif</label><input class="i" id="m-comp" type="number" inputmode="numeric" placeholder="0">
          <p class="small muted" style="margin-top:6px">Un dédommagement est ajouté automatiquement aux dépenses.</p>` });
      if (!m) return;
      await L.resolveClaim(order, Number(b.dataset.resolve), { resolution: $('#m-res', m).value, compensation: $('#m-comp', m).value });
      toast('Réclamation réglée'); after && after();
    };
  });
}

function waText(o) {
  const t = orderTotals(o);
  const base = `Bonjour ${o.clientName}, ${S.name} : facture N°${o.number}, ${t.pieces} pièce(s), total ${money(t.total)}.`;
  const pay = t.due <= 0 ? ' Réglée, merci.' : t.paid ? ` Payé ${money(t.paid)}, reste ${money(t.due)}.` : '';
  const due = L.dueDate(o) ? ` À rendre le ${fmtShort(L.dueDate(o))}.` : '';
  return base + pay + due + ' Merci de votre confiance !';
}

routes.orders = async (_, q) => {
  setNav('list');
  setTop({ title: 'Commandes' });
  const filter = q.get('s') ?? 'open';
  const all = await L.allOrders();
  const chips = [['open', 'En cours'], ...STATUS_LABEL.map((l, i) => [String(i), l]), ['unpaid', 'Impayées'], ['today', 'Du jour'], ['all', 'Toutes']];
  const v = view(`<form class="row" id="s-form" style="margin-bottom:10px"><input class="i grow" id="s-q" placeholder="Nom, téléphone ou N° de facture" autocomplete="off" value="${esc(q.get('q') || '')}"><button class="btn navy">Chercher</button></form>
    <div id="s-res"></div>
    <div class="chips">${chips.map(([k, l]) => `<a class="chip ${k === filter ? 'on' : ''}" href="#/orders?s=${k}">${l}</a>`).join('')}</div>
    <div id="s-list"></div>`);
  const today = L.todayIso();
  const pick = (o) => filter === 'open' ? o.status !== STATUS.LIVRE
    : filter === 'all' ? true : filter === 'unpaid' ? !o.paid
    : filter === 'today' ? o.createdAt.slice(0, 10) === today : o.status === Number(filter);
  const drawList = (text = '') => {
    const t = text.trim().toLowerCase();
    let list = all.filter(pick);
    if (t) list = all.filter((o) => o.clientName.toLowerCase().includes(t) || (o.clientPhone || '').replace(/\s/g, '').includes(t.replace(/\s/g, '')) || String(o.number) === t);
    $('#s-list', v).innerHTML = list.slice(0, 150).map((o) => orderCard(o)).join('') || '<div class="empty">Aucune commande ici.</div>';
  };
  $('#s-list', v).addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    busy(b, () => runAction(Number(b.dataset.act), () => routes.orders(_, q)));
  });
  $('#s-form', v).onsubmit = async (e) => {
    e.preventDefault();
    const text = $('#s-q', v).value;
    const res = $('#s-res', v);
    res.innerHTML = '';
    if (L.parseCode(text)) {
      const r = await L.findPiece(text);
      if (!r || r.missing) { res.innerHTML = `<div class="flash err">Aucune commande pour ${esc(r ? r.code : text)}.</div>`; drawList(); return; }
      const { order: o, piece: p } = r;
      const ph = p ? await L.getPhoto(pieceCode(o.number, p.index)) : null;
      res.innerHTML = `<a href="#/order/${o.number}" class="card" style="display:flex;gap:12px;align-items:center;text-decoration:none;color:inherit;border:2px solid var(--blue)">
        ${ph ? `<img class="thumb" style="width:64px;height:64px;border-radius:10px;object-fit:cover" src="${ph}">` : ''}
        <div class="grow">${p ? `<b>${esc(p.name)}</b> · Pièce ${p.index}/${o.pieces.length}<br>` : ''}<span class="small">N°${o.number} · ${esc(o.clientName)} · ${money(orderTotals(o).total)}</span></div>${badge(o)}</a>`;
      drawList();
    } else drawList(text);
  };
  $('#s-q', v).oninput = (e) => { if (!L.parseCode(e.target.value)) { $('#s-res', v).innerHTML = ''; drawList(e.target.value); } };
  drawList(q.get('q') || '');
};

routes.verify = async (number, q, stage) => {
  setNav('none');
  const o = await L.getOrder(number);
  const expected = { cousin: STATUS.COUSIN, final: STATUS.REPASSE }[stage];
  if (!o || o.status !== expected) { location.hash = `#/order/${number}`; return; }
  const title = stage === 'cousin' ? 'Retour du cousin' : 'Vérification finale';
  setTop({ title, back: `#/order/${o.number}` });
  const v = view(`<div class="card">
      <div class="row between"><b>N°${o.number} · ${esc(o.clientName)}</b><span id="v-count" class="badge blue"></span></div>
      <div class="progress" style="margin-top:10px"><i id="v-bar"></i></div>
      <p class="small muted" style="margin:8px 0 0">Touchez chaque pièce quand vous l’avez bien en main.</p></div>
    <div class="card" id="v-list"></div>
    <div class="card stack"><label class="f">Remarque / écart</label><input class="i" id="v-note" placeholder="ex. bouton manquant, tache…"><button class="btn sm" id="v-gap">Signaler un écart</button></div>
    <button class="btn green big block" id="v-ok" disabled>${stage === 'cousin' ? 'Valider : transmettre au repasseur' : 'Valider : commande prête'}</button>`);
  const photos = {};
  for (const p of o.pieces) photos[p.index] = await L.getPhoto(pieceCode(o.number, p.index));
  const draw = () => {
    const list = L.stagePieces(o, stage);
    const done = list.filter((p) => p.checks && p.checks[stage]).length;
    $('#v-count', v).textContent = `${done}/${list.length} pièces vérifiées`;
    $('#v-bar', v).style.width = (list.length ? (done / list.length) * 100 : 100) + '%';
    $('#v-list', v).innerHTML = list.map((p) => {
      const ok = p.checks && p.checks[stage];
      return `<div class="piece tap ${ok ? 'ok' : ''}" data-idx="${p.index}"><span class="tick">${ok ? '✓' : ''}</span>
        <div class="grow"><b>${esc(p.name)}</b><div class="small muted">Pièce ${p.index}/${o.pieces.length}</div></div>
        ${photos[p.index] ? `<img class="thumb" src="${photos[p.index]}" data-full="1">` : ''}</div>`;
    }).join('') + (stage === 'cousin' && o.pieces.some((p) => p.homeWash) ? `<p class="small muted">Les pièces « lavage maison » ne sont pas demandées ici.</p>` : '');
    $('#v-ok', v).disabled = !L.stageComplete(o, stage);
  };
  $('#v-list', v).onclick = async (e) => {
    const img = e.target.closest('[data-full]');
    if (img) { showImage(img.src); return; }
    const row = e.target.closest('[data-idx]'); if (!row) return;
    const on = await L.togglePiece(o, stage, Number(row.dataset.idx));
    beep(on);
    draw();
    if (on && L.stageComplete(o, stage)) toast('Toutes les pièces sont vérifiées');
  };
  $('#v-gap', v).onclick = async () => {
    const n = $('#v-note', v).value; if (!n.trim()) return;
    await L.reportGap(o, n); $('#v-note', v).value = ''; toast('Écart enregistré');
  };
  $('#v-ok', v).onclick = (e) => busy(e.currentTarget, async () => {
    await L.advance(o, stage === 'cousin' ? STATUS.A_REPASSER : STATUS.PRET);
    toast(stage === 'cousin' ? 'Transmis au repassage' : 'Commande prête');
    if (stage === 'final' && o.clientPhone && await ask({ title: 'Prévenir le client ?', text: `« ${waReady(o).split('\n')[0]} »`, ok: '📲 WhatsApp', cancel: 'Plus tard' })) openWa(o, waReady(o));
    location.hash = `#/order/${o.number}`;
  });
  draw();
};

routes.ironing = async () => {
  setNav('more');
  const list = (await L.allOrders()).filter((o) => o.status === STATUS.A_REPASSER)
    .sort((a, b) => (a.deliveryAt || '9999').localeCompare(b.deliveryAt || '9999') || a.number - b.number);
  setTop({ title: 'À repasser', right: `<span class="pill">${list.length} commande(s)</span>` });
  const v = view(list.map((o) => `<div class="card edge orange">
      <div class="row between"><b>N°${o.number} · ${esc(o.clientName)}</b><span class="badge blue">${o.pieces.length} pièces</span></div>
      <p style="margin:8px 0">${esc(L.itemsSummary(o))}</p>
      ${o.note ? `<div class="note small" style="margin-bottom:8px">Remarque : ${esc(o.note)}</div>` : ''}
      ${o.deliveryAt ? `<p class="small muted" style="margin:0 0 8px">Livraison prévue : ${fmtShort(o.deliveryAt)}</p>` : ''}
      <button class="btn primary block" data-done="${o.number}">Repassage terminé</button></div>`).join('') || '<div class="empty">Rien à repasser pour l’instant. 👍</div>');
  v.onclick = (e) => {
    const b = e.target.closest('[data-done]'); if (!b) return;
    busy(b, async () => { const o = await L.getOrder(b.dataset.done); await L.advance(o, STATUS.REPASSE); toast(`N°${o.number} repassée`); routes.ironing(); });
  };
};

routes.deliveries = async () => {
  setNav('truck');
  const list = (await L.allOrders()).filter((o) => o.status === STATUS.PRET)
    .sort((a, b) => (a.deliveryAt || '9999').localeCompare(b.deliveryAt || '9999') || a.number - b.number);
  setTop({ title: 'Livraisons', right: `<span class="pill">${list.length} prête(s)</span>` });
  const v = view(list.map((o) => {
    const t = orderTotals(o);
    return `<div class="card edge green">
      <div class="row between"><a href="#/order/${o.number}" style="color:inherit;text-decoration:none"><b>N°${o.number} · ${esc(o.clientName)}</b></a><span class="badge green">${t.pieces} pièces</span></div>
      <div class="small" style="margin:8px 0;line-height:1.7">
        ${o.deliveryFee || o.deliveryPlace ? `Lieu : <b>${esc(o.deliveryPlace || 'à préciser')}</b><br>` : 'Retrait au pressing<br>'}
        ${o.deliveryAt ? `Heure : <b>${fmtShort(o.deliveryAt)}</b><br>` : ''}
        ${o.clientPhone ? `Client : <a href="tel:${esc(o.clientPhone)}">${esc(o.clientPhone)}</a><br>` : ''}
        ${t.due <= 0 ? '<span class="badge green">Déjà payé</span>' : `À encaisser : <b>${money(t.due)}</b>${t.paid ? ` <span class="small muted">(acompte ${money(t.paid)} reçu)</span>` : ''}`}</div>
      ${t.due <= 0 ? '' : `<label class="check"><input type="checkbox" data-cash="${o.number}"> ${money(t.due)} encaissés</label>`}
      <div class="btns"><button class="btn green" data-deliv="${o.number}">Livré</button>
      ${o.clientPhone ? `<button class="btn" data-wa="${o.number}">WhatsApp</button>` : '<span></span>'}</div></div>`;
  }).join('') || '<div class="empty">Aucune commande prête.</div>');
  v.onclick = async (e) => {
    const d = e.target.closest('[data-deliv]');
    if (d) {
      const o = await L.getOrder(d.dataset.deliv);
      const cb = $(`[data-cash="${o.number}"]`, v);
      if (await deliverFlow(o, cb ? cb.checked : null)) routes.deliveries();
      return;
    }
    const w = e.target.closest('[data-wa]');
    if (w) { const o = await L.getOrder(w.dataset.wa); openWa(o, waReady(o)); }
  };
};

routes.clients = async (_, q) => {
  setNav('more');
  setTop({ title: 'Clients', back: '#/more', right: '<a class="pill" href="#/clientform" style="text-decoration:none">+ Ajouter</a>' });
  const sort = q.get('t') || 'name';
  const all = L.clientsWithStats(await L.getClientsReg(), await db.all('orders'));
  const sorters = { name: (a, b) => a.name.localeCompare(b.name), spent: (a, b) => b.spent - a.spent, recent: (a, b) => b.lastAt.localeCompare(a.lastAt), due: (a, b) => b.totalDue - a.totalDue, count: (a, b) => b.orders.length - a.orders.length };
  const v = view(`<input class="i" id="c-q" placeholder="Chercher un nom ou un numéro" autocomplete="off" style="margin-bottom:10px">
    <div class="chips">${[['name', 'A → Z'], ['spent', 'Meilleurs clients'], ['recent', 'Récents'], ['count', 'Plus fidèles'], ['due', 'Qui doivent']].map(([k, l]) => `<a class="chip ${k === sort ? 'on' : ''}" href="#/clients?t=${k}">${l}</a>`).join('')}</div>
    <p class="small muted" style="margin:0 0 8px">${all.length} client(s)</p>
    <div id="c-list"></div>`);
  const draw = (text = '') => {
    const t = text.trim().toLowerCase(), d = t.replace(/\D/g, '');
    let list = all.slice().sort(sorters[sort]);
    if (sort === 'due') list = list.filter((c) => c.totalDue > 0);
    if (t) list = list.filter((c) => c.name.toLowerCase().includes(t) || (d.length >= 3 && (c.phone || '').replace(/\D/g, '').includes(d)));
    $('#c-list', v).innerHTML = list.slice(0, 300).map((c, i) => `<a class="card client-row" href="#/client/${c.id}">
      <span class="rank">${sort === 'spent' && !t ? i + 1 : c.sex === 'F' ? '👩' : c.sex === 'M' ? '👨' : '👤'}</span>
      <div class="grow"><b>${esc(c.name)}</b><div class="small muted">${esc(c.phone || 'sans numéro')} · ${c.orders.length} commande(s)${c.orders.length ? ' · dernière ' + fmtDate(c.lastAt, false) : ''}</div></div>
      <div class="right"><b>${money(c.spent)}</b>${c.totalDue > 0 ? `<div class="small" style="color:var(--red)">doit ${money(c.totalDue)}</div>` : ''}</div></a>`).join('') || '<div class="empty">Aucun client.</div>';
  };
  $('#c-q', v).oninput = (e) => draw(e.target.value);
  draw();
};

routes.clientform = async (id) => {
  setNav('more');
  const c = id ? await L.getClientReg(Number(id)) : null;
  setTop({ title: c ? 'Modifier le client' : 'Nouveau client', back: c ? `#/client/${c.id}` : '#/clients' });
  const v = view(`<div class="card stack">
      <div class="grid2"><div><label class="f">Nom</label><input class="i" id="cf-last" autocapitalize="characters" value="${esc(c ? c.lastName : '')}"></div>
        <div><label class="f">Prénom</label><input class="i" id="cf-first" autocapitalize="words" value="${esc(c ? c.firstName : '')}"></div></div>
      <label class="f">Sexe</label>
      <div class="seg sex" id="cf-sex"><a data-sex="M" class="${c && c.sex === 'M' ? 'on' : ''}">Monsieur</a><a data-sex="F" class="${c && c.sex === 'F' ? 'on' : ''}">Madame</a></div>
      <div><label class="f">Numéro WhatsApp</label><input class="i" id="cf-phone" type="tel" inputmode="tel" value="${esc(c ? c.phone : '')}" placeholder="ex. 01 97 00 00 00"></div>
      <div><label class="f">Ancien solde / arriéré (F) — ce qu'il doit déjà</label><input class="i" id="cf-arr" type="number" inputmode="numeric" min="0" value="${c && c.arrears ? c.arrears : ''}" placeholder="0"></div>
      <div><label class="f">Note</label><input class="i" id="cf-note" value="${esc(c ? c.note : '')}" placeholder="ex. client du quartier, préfère la livraison"></div>
      <button class="btn primary big block" id="cf-save">${c ? 'Enregistrer' : 'Ajouter le client'}</button>
    </div>`);
  $('#cf-sex', v).onclick = (e) => { const a = e.target.closest('[data-sex]'); if (!a) return; $$('#cf-sex a', v).forEach((x) => x.classList.toggle('on', x === a)); };
  $('#cf-save', v).onclick = (e) => busy(e.currentTarget, async () => {
    const sexA = $('#cf-sex a.on', v);
    if (!sexA) throw new Error('Choisissez Monsieur ou Madame.');
    const rec = await L.saveClient({ ...(c || {}), lastName: $('#cf-last', v).value, firstName: $('#cf-first', v).value, sex: sexA.dataset.sex, phone: $('#cf-phone', v).value, arrears: $('#cf-arr', v).value, note: $('#cf-note', v).value });
    toast(c ? 'Client modifié' : 'Client ajouté');
    location.hash = `#/client/${rec.id}`;
  });
};

routes.client = async (id) => {
  setNav('more');
  const reg = await L.getClientsReg();
  const c = L.clientsWithStats(reg, await db.all('orders')).find((x) => x.id === Number(id));
  setTop({ title: 'Fiche client', back: '#/clients', right: c ? `<a class="pill" href="#/clientform/${c.id}" style="text-decoration:none">Modifier</a>` : '' });
  if (!c) { view('<div class="empty">Client introuvable.</div>'); return; }
  const lp = L.loyaltyProgress(S, c.orders.length);
  const fav = {};
  for (const o of c.orders) for (const i of o.items) fav[i.name] = (fav[i.name] || 0) + i.qty;
  const favs = Object.entries(fav).sort((a, b) => b[1] - a[1]).slice(0, 4);
  const v = view(`<div class="hero"><span>${L.civility(c.sex)}${c.orders.length ? ` · ${c.orders.length} commande(s) depuis le ${fmtDate(c.firstAt, false)}` : ' · nouveau client'}</span><b>${esc(c.name)}</b>
      <small>${esc(c.phone || 'sans numéro')}${c.note ? ' · ' + esc(c.note) : ''}</small></div>
    <div class="kpis" style="margin-top:10px">
      <div class="kpi"><span>Total dépensé</span><b>${money(c.spent)}</b></div>
      <div class="kpi"><span>Panier moyen</span><b>${money(c.orders.length ? c.spent / c.orders.length : 0)}</b></div>
      <div class="kpi"><span>Pièces confiées</span><b>${c.pieces}</b></div>
      <div class="kpi"><span>Doit en tout</span><b style="color:${c.totalDue ? 'var(--red)' : 'inherit'}">${money(c.totalDue)}</b>${c.arrears ? `<span>dont ancien solde ${money(c.arrears)}</span>` : ''}</div></div>
    ${lp ? `<div class="card" style="margin-top:12px"><h3 class="ch-title">🎁 Fidélité</h3>
      <div class="dots">${Array.from({ length: lp.every }, (_, i) => `<i class="${i < lp.done ? 'on' : ''} ${i === lp.every - 1 ? 'gift' : ''}"></i>`).join('')}</div>
      <p class="small" style="margin:8px 0 0">${lp.left === 0 ? '<b>Sa prochaine commande est récompensée !</b>' : `Encore ${lp.left + 1} commande(s) avant la récompense`}.</p></div>` : ''}
    <div class="btns" style="margin:12px 0">
      <a class="btn primary" href="#/new?cid=${c.id}">+ Nouvelle facture</a>
      ${c.phone ? `<button class="btn wa" id="cl-wa">WhatsApp</button>` : '<span></span>'}
    </div>
    ${favs.length ? `<div class="card"><h3 class="ch-title">Ce qu'il confie le plus</h3>${Charts.hbars(favs, (n) => n + ' pcs')}</div>` : ''}
    ${c.orders.length ? `<h2>Historique</h2>${c.orders.slice().reverse().map((o) => orderCard(o, { showAction: false })).join('')}` : ''}`);
  Charts.enableTips(v);
  if ($('#cl-wa', v)) $('#cl-wa', v).onclick = () => waOpen(c.phone, `Bonjour ${L.civility(c.sex)} ${String(c.lastName).toUpperCase()},`, S);
};

routes.promos = async () => {
  if (needAdmin('promos')) return;
  setNav('more');
  setTop({ title: 'Promotions', back: '#/more', right: '<a class="pill" href="#/promoform" style="text-decoration:none">+ Ajouter</a>' });
  const list = await L.getPromos();
  const arts = await L.getArticles();
  const v = view(`<p class="small muted" style="margin:0 0 10px">Les promotions <b>automatiques</b> s'appliquent seules sur la facture ; les autres y sont proposées à cocher.</p>
    ${list.map((p) => `<div class="card edge ${p.active && L.promoActiveNow(p) ? 'green' : 'done'}">
      <div class="row between"><b>${esc(p.name)}</b><label class="switch"><input type="checkbox" data-toggle="${p.id}" ${p.active ? 'checked' : ''}><span></span></label></div>
      <p class="small" style="margin:6px 0">${esc(L.promoDescription(p, arts))}</p>
      <div class="small muted">${p.auto ? '⚡ Automatique' : '☑️ Au choix sur la facture'}${p.active && !L.promoActiveNow(p) ? ' · pas valable aujourd’hui' : ''}</div>
      <div class="btns" style="margin-top:8px"><a class="btn sm" href="#/promoform/${p.id}">Modifier</a><button class="btn sm danger" data-pdel="${p.id}">Supprimer</button></div></div>`).join('') || '<div class="empty">Aucune promotion. Touchez « + Ajouter ».</div>'}`);
  v.onchange = async (e) => {
    const t = e.target.closest('[data-toggle]'); if (!t) return;
    const l = await L.getPromos(); const p = l.find((x) => x.id === Number(t.dataset.toggle)); p.active = t.checked;
    await L.savePromos(l); toast(p.active ? 'Promotion activée' : 'Promotion désactivée'); routes.promos();
  };
  v.onclick = async (e) => {
    const d = e.target.closest('[data-pdel]'); if (!d) return;
    if (!(await ask({ title: 'Supprimer cette promotion ?', text: 'Les factures déjà faites gardent leur remise.', ok: 'Supprimer', danger: true }))) return;
    await L.savePromos((await L.getPromos()).filter((x) => x.id !== Number(d.dataset.pdel))); routes.promos();
  };
};

routes.promoform = async (id) => {
  if (needAdmin('promos')) return;
  setNav('more');
  const p = id ? (await L.getPromos()).find((x) => x.id === Number(id)) : null;
  const arts = await L.getArticles();
  const cur = p || { name: '', type: 'percent', value: 10, scope: 'all', articles: [], minAmount: 0, from: '', to: '', days: [], auto: true, active: true };
  setTop({ title: p ? 'Modifier la promotion' : 'Nouvelle promotion', back: '#/promos' });
  const v = view(`<div class="card stack">
      <div><label class="f">Nom (affiché sur la facture)</label><input class="i" id="pf-name" value="${esc(cur.name)}" placeholder="ex. Promo Tabaski, Mercredi chemises"></div>
      <div class="grid2"><div><label class="f">Remise</label><input class="i" id="pf-val" type="number" min="0" value="${cur.value}"></div>
        <div><label class="f">Type</label><select class="i" id="pf-type">
          <option value="percent" ${cur.type === 'percent' ? 'selected' : ''}>%</option>
          <option value="amount" ${cur.type === 'amount' ? 'selected' : ''}>F (sur la commande)</option>
          <option value="perPiece" ${cur.type === 'perPiece' ? 'selected' : ''}>F par pièce</option></select></div></div>
      <label class="f">S'applique sur</label>
      <div class="seg" id="pf-scope"><a data-s="all" class="${cur.scope !== 'articles' ? 'on' : ''}">Toute la commande</a><a data-s="articles" class="${cur.scope === 'articles' ? 'on' : ''}">Certains articles</a></div>
      <div id="pf-arts" class="${cur.scope === 'articles' ? '' : 'hidden'}">${arts.map((a) => `<label class="check"><input type="checkbox" value="${a.id}" ${(cur.articles || []).includes(a.id) ? 'checked' : ''}> ${esc(a.name)} <span class="muted small">${money(a.price)}</span></label>`).join('')}</div>
      <div><label class="f">Minimum de commande (F, articles) — facultatif</label><input class="i" id="pf-min" type="number" min="0" value="${cur.minAmount || ''}" placeholder="0 = aucun"></div>
      <div class="grid2"><div><label class="f">Du — facultatif</label><input class="i" id="pf-from" type="date" value="${cur.from || ''}"></div>
        <div><label class="f">Au — facultatif</label><input class="i" id="pf-to" type="date" value="${cur.to || ''}"></div></div>
      <label class="f">Jours de la semaine (aucun coché = tous les jours)</label>
      <div class="days" id="pf-days">${L.PROMO_DAYS.map((d, i) => `<a data-d="${i}" class="${(cur.days || []).includes(i) ? 'on' : ''}">${d}</a>`).join('')}</div>
      <label class="check"><input type="checkbox" id="pf-auto" ${cur.auto ? 'checked' : ''}> ⚡ Appliquer automatiquement (sinon, proposée à cocher)</label>
      <label class="check"><input type="checkbox" id="pf-active" ${cur.active ? 'checked' : ''}> Promotion active</label>
      <button class="btn primary big block" id="pf-save">${p ? 'Enregistrer' : 'Créer la promotion'}</button>
    </div>`);
  $('#pf-scope', v).onclick = (e) => { const a = e.target.closest('[data-s]'); if (!a) return; $$('#pf-scope a', v).forEach((x) => x.classList.toggle('on', x === a)); $('#pf-arts', v).classList.toggle('hidden', a.dataset.s !== 'articles'); };
  $('#pf-days', v).onclick = (e) => { const a = e.target.closest('[data-d]'); if (a) a.classList.toggle('on'); };
  $('#pf-save', v).onclick = async () => {
    const rec = {
      ...cur, id: cur.id || Date.now(), name: $('#pf-name', v).value.trim(), type: $('#pf-type', v).value, value: Number($('#pf-val', v).value) || 0,
      scope: $('#pf-scope a.on', v).dataset.s, articles: $$('#pf-arts input:checked', v).map((x) => Number(x.value)),
      minAmount: Number($('#pf-min', v).value) || 0, from: $('#pf-from', v).value, to: $('#pf-to', v).value,
      days: $$('#pf-days a.on', v).map((x) => Number(x.dataset.d)), auto: $('#pf-auto', v).checked, active: $('#pf-active', v).checked,
    };
    if (!rec.name) { toast('Donnez un nom à la promotion', true); return; }
    if (rec.value <= 0) { toast('Indiquez le montant de la remise', true); return; }
    if (rec.scope === 'articles' && !rec.articles.length) { toast('Cochez au moins un article', true); return; }
    if (rec.type === 'percent' && rec.value > 100) { toast('100 % maximum', true); return; }
    const list = (await L.getPromos()).filter((x) => x.id !== rec.id); list.push(rec);
    await L.savePromos(list); toast('Promotion enregistrée'); location.hash = '#/promos';
  };
};

routes.claims = async (_, q) => {
  setNav('more');
  setTop({ title: 'Réclamations', back: '#/more' });
  const showAll = q.get('all') === '1';
  const orders = await db.all('orders');
  const rows = [];
  for (const o of orders) for (const c of o.claims || []) if (showAll || c.status === 'open') rows.push({ o, c });
  rows.sort((a, b) => b.c.createdAt.localeCompare(a.c.createdAt));
  const v = view(`<div class="seg" style="margin-bottom:12px"><a class="${showAll ? '' : 'on'}" href="#/claims">À régler</a><a class="${showAll ? 'on' : ''}" href="#/claims?all=1">Toutes</a></div>
    <p class="small muted" style="margin:0 0 10px">Pour signaler un problème : ouvrez la facture → « ⚠️ Réclamation ».</p>
    ${rows.map(({ o, c }) => `<a class="small" href="#/order/${o.number}" style="display:block;margin:0 0 4px 4px">N°${o.number} · ${esc(o.clientName)} ›</a>${claimCard(o, c)}`).join('') || `<div class="empty">${showAll ? 'Aucune réclamation.' : 'Aucune réclamation à régler. 👍'}</div>`}`);
  bindClaims(v, null, () => routes.claims(_, q));
};

routes.cousin = async () => {
  if (needAdmin('cousin')) return;
  setNav('more');
  setTop({ title: 'Compte du cousin', back: '#/more' });
  const pays = await L.getCousinPayments();
  const sm = L.cousinSummary(await db.all('orders'), pays);
  const v = view(`<div class="hero ${sm.left > 0 ? 'neg' : ''}"><span>Reste à payer au cousin</span><b>${money(sm.left)}</b>
      <small>${L.kg(sm.kg)} lavés · tarif actuel ${money(S.cousinRate)}/kg</small></div>
    <div class="kpis" style="margin-top:10px"><div class="kpi"><span>Total dû (lavages)</span><b>${money(sm.owed)}</b></div>
      <div class="kpi"><span>Déjà payé</span><b>${money(sm.paid)}</b></div></div>
    <div class="card stack" style="margin-top:12px"><b>Enregistrer un paiement au cousin</b>
      <div class="grid2"><div><label class="f">Montant (F)</label><input class="i" id="k-amt" type="number" inputmode="numeric" placeholder="${Math.max(0, sm.left)}"></div>
        <div><label class="f">Date</label><input class="i" id="k-date" type="date" value="${L.todayIso()}"></div></div>
      <input class="i" id="k-note" placeholder="Note (ex. espèces, MoMo)">
      <button class="btn primary block" id="k-save">Enregistrer le paiement</button>
      <p class="small muted" style="margin:0">Ne le saisissez pas aussi dans Dépenses : le lavage est déjà compté dans le bilan à partir des factures.</p></div>
    ${pays.length ? `<h2>Paiements faits</h2><div class="card calc">${pays.slice().reverse().map((p) => `<div class="l"><span>${fmtDate(p.date, false)}${p.note ? ' · ' + esc(p.note) : ''}</span><span>${money(p.amount)} <button class="btn sm danger" data-kdel="${p.id}" style="min-height:30px;padding:2px 8px">✕</button></span></div>`).join('')}</div>` : ''}
    <h2>Commandes envoyées (${sm.sent.length})</h2>
    <div class="card calc">${sm.sent.slice(0, 100).map((r) => `<a class="l" href="#/order/${r.o.number}" style="color:inherit;text-decoration:none"><span>${fmtDate(r.at, false)} · N°${r.o.number} · ${L.kg(r.kg)}</span><span>${money(r.amount)}</span></a>`).join('') || '<p class="muted small">Aucune commande envoyée au cousin.</p>'}</div>`);
  $('#k-save', v).onclick = async () => {
    try { await L.addCousinPayment($('#k-amt', v).value, $('#k-note', v).value, $('#k-date', v).value); toast('Paiement enregistré'); routes.cousin(); }
    catch (e) { toast(e.message, true); }
  };
  $$('[data-kdel]', v).forEach((b) => { b.onclick = async () => {
    if (!(await ask({ title: 'Supprimer ce paiement ?', ok: 'Supprimer', danger: true }))) return;
    await L.deleteCousinPayment(Number(b.dataset.kdel)); routes.cousin();
  }; });
};

routes.more = async () => {
  setNav('more');
  setTop({ title: 'Plus' });
  const lock = (t) => (S.adminPin && !unlocked ? `<span class="lock">🔒 ${t || ''}</span>` : '');
  const v = view(`<div class="card menu">
      <a href="#/ironing"><span class="ic">👕</span>Repassage</a>
      <a href="#/clients"><span class="ic">👥</span>Clients</a>
      <a href="#/promos"><span class="ic">🏷️</span>Promotions${lock()}</a>
      <a href="#/claims"><span class="ic">⚠️</span>Réclamations</a>
      <a href="#/cousin"><span class="ic">🧺</span>Compte du cousin${lock()}</a>
      <a href="#/orders?s=all"><span class="ic">🧾</span>Toutes les factures</a>
      <a href="#/bilan"><span class="ic">📊</span>Bilan${lock()}</a>
      <a href="#/expenses"><span class="ic">💸</span>Dépenses${lock()}</a>
      <a href="#/settings"><span class="ic">⚙️</span>Réglages et tarifs${lock()}</a>
      <a href="#/backup"><span class="ic">💾</span>Sauvegarde des données</a>
    </div>
    ${S.adminPin ? `<button class="btn ${unlocked ? 'ghost' : 'navy'} block" id="m-lock">${unlocked ? 'Verrouiller le mode admin' : 'Déverrouiller le mode admin'}</button>` : ''}
    <p class="small muted" style="text-align:center;margin-top:20px">Smart Pressing · données stockées dans ce téléphone${isNative ? '' : ' (navigateur)'}</p>`);
  if ($('#m-lock', v)) $('#m-lock', v).onclick = () => { if (unlocked) { unlocked = false; toast('Verrouillé'); routes.more(); } else location.hash = '#/unlock?next=more'; };
};

routes.unlock = async (_, q) => {
  setNav('none');
  setTop({ title: 'Mode admin', back: '#/home' });
  const v = view(`<div class="card stack" style="margin-top:20px"><p class="muted" style="margin:0">Entrez le code administrateur.</p>
    <form id="u-form" class="stack"><input class="i pin" id="u-pin" type="password" inputmode="numeric" autocomplete="off">
    <button class="btn primary big block">Déverrouiller</button></form></div>`);
  $('#u-pin', v).focus();
  $('#u-form', v).onsubmit = (e) => {
    e.preventDefault();
    if ($('#u-pin', v).value === S.adminPin) { unlocked = true; toast('Mode admin ouvert'); location.hash = '#/' + (q.get('next') || 'home'); }
    else { toast('Code incorrect', true); $('#u-pin', v).value = ''; }
  };
};

function needAdmin(name) {
  if (isAdmin()) return false;
  location.hash = '#/unlock?next=' + name;
  return true;
}

routes.bilan = async (_, q) => {
  if (needAdmin('bilan')) return;
  setNav('more');
  setTop({ title: 'Bilan', back: '#/more', right: '<button class="pill" id="b-export">⇩ Exporter</button>' });
  const kind = ['month', 'half', 'year'].includes(q.get('k')) ? q.get('k') : 'month';
  const off = Number(q.get('o') || 0);
  const p = L.period(kind, off);
  const [orders, expenses] = [await db.all('orders'), await db.all('expenses')];
  const b = L.computeBilan(orders, expenses, p, S);
  const today = L.todayIso();
  const fm = (n) => money(n);

  // Graphique principal
  let main;
  if (kind === 'month') {
    const days = L.daysBetween(p.start, p.end);
    main = `<h3 class="ch-title">Chiffre d'affaires par jour</h3>` + Charts.barChart({
      labels: days.map((d) => String(Number(d.slice(8)))), tips: days.map((d) => fmtDate(d, false)),
      series: [{ name: "Chiffre d'affaires", color: Charts.C.ca, values: days.map((d) => b.byDay[d] || 0) }],
      fmt: fm, highlight: days.indexOf(today), every: 5,
    });
  } else {
    const months = L.monthsBetween(p.start, p.end);
    const mm = months.map((m) => b.byMonth[m] || { ca: 0, wash: 0, exp: 0, inv: 0 });
    const lab = months.map((m) => L.monthShort(Number(m.slice(5)) - 1));
    const tips = months.map((m) => L.monthName(Number(m.slice(5)) - 1) + ' ' + m.slice(0, 4));
    main = `<h3 class="ch-title">Recettes et charges par mois</h3>` + Charts.barChart({
      labels: lab, tips, fmt: fm,
      series: [
        { name: "Chiffre d'affaires", color: Charts.C.ca, values: mm.map((r) => r.ca) },
        { name: 'Lavage cousin', color: Charts.C.wash, values: mm.map((r) => r.wash) },
        { name: 'Dépenses', color: Charts.C.exp, values: mm.map((r) => r.exp + r.inv) },
      ],
    }) + `<h3 class="ch-title" style="margin-top:18px">Bénéfice net par mois</h3>` + Charts.barChart({
      labels: lab, tips, fmt: fm, height: 150,
      series: [{ name: 'Bénéfice net', color: Charts.C.pos, colorFn: (v) => (v < 0 ? Charts.C.neg : Charts.C.pos), values: mm.map((r) => r.ca - r.wash - r.exp) }],
    });
  }

  const split = Charts.splitBar([
    { name: 'Lavage cousin', value: b.wash, color: Charts.C.wash },
    { name: 'Dépenses courantes', value: b.current, color: Charts.C.exp },
    { name: 'Bénéfice net', value: Math.max(0, b.net), color: Charts.C.pos },
  ], fm);
  const cats = Object.entries(b.expByCat).sort((a, c) => c[1] - a[1]).map(([k, v]) => [L.catLabel(k), v]);
  const prevP = L.period(kind, off - 1);
  const prev = L.computeBilan(orders, expenses, prevP, S);
  const delta = (cur, old) => {
    if (!old) return '';
    const d = Math.round(((cur - old) / Math.abs(old)) * 100);
    return `<em class="${d >= 0 ? 'up' : 'down'}">${d >= 0 ? '▲' : '▼'} ${Math.abs(d)} %</em>`;
  };

  const v = view(`<div class="seg">${[['month', 'Mois'], ['half', '6 mois'], ['year', 'Année']].map(([k, l]) => `<a class="${k === kind ? 'on' : ''}" href="#/bilan?k=${k}">${l}</a>`).join('')}</div>
    <div class="periodnav"><button data-o="${off - 1}" aria-label="Précédent">‹</button><div class="lbl">${p.label}</div><button data-o="${off + 1}" ${off >= 0 ? 'disabled style="opacity:.3"' : ''} aria-label="Suivant">›</button></div>
    <div class="hero ${b.net < 0 ? 'neg' : ''}"><span>Bénéfice net</span><b>${money(b.net)}</b>
      <small>${b.orders} commande(s) · CA ${money(b.ca)} ${delta(b.ca, prev.ca)}</small></div>
    <div class="kpis" style="margin-top:10px">
      <div class="kpi"><span>Chiffre d'affaires</span><b>${money(b.ca)}</b>${delta(b.ca, prev.ca)}</div>
      <div class="kpi"><span>Marge après lavage</span><b>${money(b.margin)}</b>${delta(b.margin, prev.margin)}</div>
      <div class="kpi"><span>Encaissé</span><b>${money(b.cashed)}</b></div>
      <div class="kpi"><span>Impayés</span><b style="color:${b.unpaid ? 'var(--red)' : 'inherit'}">${money(b.unpaid)}</b></div></div>
    <p class="small muted" style="margin:6px 2px 0">Les pourcentages comparent à la période précédente (${prevP.label}). Touchez un graphique pour voir les valeurs.</p>
    <div class="card" style="margin-top:12px">${main}</div>
    <div class="card"><h3 class="ch-title">Où va le chiffre d'affaires</h3>${split}${b.net < 0 ? `<p class="small" style="color:var(--red);margin:8px 0 0;font-weight:600">Les charges dépassent le chiffre d'affaires de ${money(-b.net)}.</p>` : ''}</div>
    ${b.washRatio > 0.35 ? `<div class="alert" style="margin-bottom:12px">Le lavage représente ${Math.round(b.washRatio * 100)} % du CA (alerte au-dessus de 35 %). Vérifiez les prix ou le poids.</div>` : ''}
    <div class="card calc">
      <h3 class="ch-title">Compte de résultat</h3>
      <div class="l"><span>Chiffre d'affaires (${b.orders} commandes)</span><span>${money(b.ca)}</span></div>
      <div class="l"><span>− Lavage chez le cousin (${L.kg(b.washKg)})</span><span>− ${money(b.wash)}</span></div>
      <div class="l sum"><span>= Marge après lavage</span><span>${money(b.margin)}</span></div>
      <div class="l"><span>− Dépenses courantes</span><span>− ${money(b.current)}</span></div>
      <div class="l net ${b.net < 0 ? 'neg' : ''}"><span>BÉNÉFICE NET</span><span>${money(b.net)}</span></div>
      <div class="l"><span>− Investissements</span><span>− ${money(b.invest)}</span></div>
      <div class="l sum"><span>Net après investissements</span><span>${money(b.netAfterInvest)}</span></div>
    </div>
    <div class="kpis"><div class="kpi"><span>À payer au cousin</span><b>${money(b.wash)}</b><span>${L.kg(b.washKg)} lavés</span></div>
      <div class="kpi"><span>À mettre de côté (${S.savingsPercent} %)</span><b>${money(b.savings)}</b><span>Lavage/CA ${Math.round(b.washRatio * 100)} %</span></div></div>
    ${cats.length ? `<div class="card" style="margin-top:12px"><h3 class="ch-title">Dépenses par catégorie</h3>${Charts.hbars(cats, fm, Charts.C.exp)}</div>` : ''}
    <div class="card" style="margin-top:12px"><h3 class="ch-title">Articles les plus lavés</h3>
      ${Charts.hbars(b.topArticles, (n) => n + ' pcs') || '<p class="muted small">Aucune commande sur la période.</p>'}</div>
    <div class="btns"><button class="btn navy" id="b-pdf">⇩ Bilan en PDF</button><button class="btn green" id="b-xlsx">⇩ Bilan en Excel</button></div>
    <a class="btn block ghost" href="#/expenses" style="margin-top:8px">Voir et saisir les dépenses →</a>`);
  Charts.enableTips(v);
  $$('[data-o]', v).forEach((btn) => { btn.onclick = () => { if (!btn.disabled) location.hash = `#/bilan?k=${kind}&o=${btn.dataset.o}`; }; });
  const doExport = async (fmt, btn) => busy(btn, async () => {
    const blob = fmt === 'pdf' ? bilanPdf(b, p, S) : bilanXlsx(b, p, S);
    const name = bilanFileName(p, fmt);
    const r = await shareFile(blob, name, 'Bilan ' + p.label);
    if (r === 'downloaded') toast('Fichier enregistré : ' + name);
  });
  $('#b-pdf', v).onclick = (e) => doExport('pdf', e.currentTarget);
  $('#b-xlsx', v).onclick = (e) => doExport('xlsx', e.currentTarget);
  $('#b-export').onclick = async () => {
    const m = await ask({ title: 'Exporter le bilan', ok: 'Exporter',
      body: `<p>${esc(p.label)}</p><div class="seg" style="margin-bottom:6px"><a class="on" data-f="pdf">PDF</a><a data-f="xlsx">Excel</a></div>
        <p class="small muted" style="margin-top:8px">Changez de période (Mois, 6 mois, Année et flèches) avant d'exporter.</p>` ,
      onOpen: (bg) => { bg.querySelectorAll('[data-f]').forEach((a) => { a.onclick = () => { bg.querySelectorAll('[data-f]').forEach((x) => x.classList.toggle('on', x === a)); }; }); } });
    if (!m) return;
    const f = m.querySelector('[data-f].on').dataset.f;
    doExport(f, $('#b-export'));
  };
};

routes.expenses = async (_, q) => {
  if (needAdmin('expenses')) return;
  setNav('more');
  setTop({ title: 'Dépenses', back: '#/more' });
  const off = Number(q.get('o') || 0);
  const p = L.period('month', off);
  const all = await L.allExpenses();
  const list = all.filter((e) => e.date >= p.start && e.date <= p.end);
  const editing = q.get('edit') ? all.find((e) => e.id === Number(q.get('edit'))) : null;
  const total = list.reduce((s, e) => s + e.amount, 0);
  const byCat = {};
  for (const e of list) byCat[e.category] = (byCat[e.category] || 0) + e.amount;
  const cats = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
  const maxC = Math.max(1, ...cats.map((c) => c[1]));
  const today = L.todayIso();
  const defDate = editing ? editing.date : (today >= p.start && today <= p.end ? today : p.start);
  const v = view(`<div class="periodnav"><button data-o="${off - 1}">‹</button><div class="lbl">${p.label}</div><button data-o="${off + 1}">›</button></div>
    <div class="card stack"><b>${editing ? 'Modifier la dépense' : 'Nouvelle dépense'}</b>
      <div class="grid2"><div><label class="f">Date</label><input class="i" type="date" id="e-date" value="${defDate}"></div>
        <div><label class="f">Montant (F)</label><input class="i" type="number" inputmode="numeric" id="e-amount" min="0" value="${editing ? editing.amount : ''}"></div></div>
      <div><label class="f">Catégorie</label><select class="i" id="e-cat">${L.EXPENSE_CATEGORIES.map((c) => `<option value="${c.key}" ${editing && editing.category === c.key ? 'selected' : ''}>${c.label}</option>`).join('')}</select></div>
      <div><label class="f">Détail</label><input class="i" id="e-label" placeholder="ex. carburant moto" value="${esc(editing ? editing.label : '')}"></div>
      <button class="btn primary block" id="e-save">${editing ? 'Enregistrer' : 'Ajouter la dépense'}</button>
      ${editing ? `<a class="btn ghost block" href="#/expenses?o=${off}">Annuler</a>` : ''}
    </div>
    <div class="kpis"><div class="kpi"><span>Total du mois</span><b>${money(total)}</b></div><a class="kpi" href="#/bilan?k=month&o=${off}" style="text-decoration:none;color:var(--blue)"><span>Bénéfice net</span><b>Voir →</b></a></div>
    ${cats.length ? `<div class="card" style="margin-top:12px"><b class="small muted">Par catégorie</b>${cats.map(([k, a]) => `<div class="hbar"><span class="lbl">${esc(L.catLabel(k))}</span><span class="track"><i style="width:${(a / maxC) * 100}%;${L.catInvest(k) ? 'background:var(--orange)' : ''}"></i></span><b>${money(a)}</b></div>`).join('')}</div>` : ''}
    <div id="e-list" style="margin-top:12px">${list.map((e) => `<div class="card row"><div class="grow"><b>${esc(L.catLabel(e.category))}</b> · ${fmtDate(e.date, false).slice(0, 5)}<div class="small muted">${esc(e.label)}</div></div>
      <b>${money(e.amount)}</b><a class="btn sm" href="#/expenses?o=${off}&edit=${e.id}">✎</a><button class="btn sm danger" data-del="${e.id}">✕</button></div>`).join('') || '<div class="empty">Aucune dépense ce mois-ci.</div>'}</div>`);
  $$('[data-o]', v).forEach((b) => { b.onclick = () => { location.hash = `#/expenses?o=${b.dataset.o}`; }; });
  $('#e-save', v).onclick = async () => {
    const amount = Math.round(Number($('#e-amount', v).value));
    if (!amount || amount <= 0) { toast('Indiquez un montant', true); return; }
    const rec = { date: $('#e-date', v).value || today, amount, category: $('#e-cat', v).value, label: $('#e-label', v).value.trim(), createdAt: editing ? editing.createdAt : L.nowIso() };
    if (editing) rec.id = editing.id;
    await db.put('expenses', rec);
    toast(editing ? 'Dépense modifiée' : 'Dépense ajoutée');
    location.hash = `#/expenses?o=${off}&t=${Date.now()}`;
  };
  $('#e-list', v).onclick = async (e) => {
    const b = e.target.closest('[data-del]'); if (!b) return;
    if (!(await ask({ title: 'Supprimer cette dépense ?', ok: 'Supprimer', danger: true }))) return;
    await db.del('expenses', Number(b.dataset.del)); toast('Supprimée'); routes.expenses(_, q);
  };
};

routes.settings = async () => {
  if (needAdmin('settings')) return;
  setNav('more');
  setTop({ title: 'Réglages', back: '#/more' });
  const arts = await L.getArticles();
  const v = view(`<div class="card stack"><b>Le pressing</b>
      <div class="row">${S.logo ? `<img src="${S.logo}" style="width:110px;height:68px;border-radius:12px;object-fit:contain;background:#fff;border:1px solid var(--line)">` : '<div class="thumb" style="width:64px;height:64px;border-radius:12px;background:var(--bg);display:grid;place-items:center" >logo</div>'}
        <label class="btn sm">Choisir le logo<input type="file" accept="image/*" id="s-logo" hidden></label>${S.logo ? '<button class="btn sm ghost" id="s-nologo">Retirer</button>' : ''}</div>
      <div><label class="f">Nom</label><input class="i" id="s-name" value="${esc(S.name)}"></div>
      <div class="grid2"><div><label class="f">Ville</label><input class="i" id="s-city" value="${esc(S.city)}"></div>
        <div><label class="f">Téléphone</label><input class="i" id="s-phone" type="tel" value="${esc(S.phone)}"></div></div>
      <div class="grid2"><div><label class="f">Tarif du cousin (F/kg)</label><input class="i" id="s-rate" type="number" value="${S.cousinRate}"></div>
        <div><label class="f">Frais de livraison (F)</label><input class="i" id="s-deliv" type="number" value="${S.deliveryFee}"></div></div>
      <div class="grid2"><div><label class="f">% mis de côté</label><input class="i" id="s-sav" type="number" value="${S.savingsPercent}"></div>
        <div><label class="f">Premier N° de facture</label><input class="i" id="s-start" type="number" value="${S.invoiceStart}"></div></div>
      <div class="grid2"><div><label class="f">Délai de rendu (jours)</label><input class="i" id="s-due" type="number" min="0" value="${S.dueDays}"></div><div></div></div>
      <label class="check"><input type="checkbox" id="s-mr" ${S.monthlyReport !== false ? 'checked' : ''}> 📊 Bilan mensuel automatique (le 1er du mois${isNative ? ', avec notification à 9 h' : ''})</label>
      <a class="btn ghost block" href="#/promos">🏷️ Gérer les promotions (remises, 10 % dès 5 000 F…)</a>
      <b style="margin-top:6px">💬 WhatsApp</b>
      <div class="grid2"><div><label class="f">Envoyer avec</label><select class="i" id="s-waapp"><option value="business" ${S.waApp !== 'normal' ? 'selected' : ''}>WhatsApp Business</option><option value="normal" ${S.waApp === 'normal' ? 'selected' : ''}>WhatsApp</option></select></div>
        <div><label class="f">Numéro WhatsApp du pressing</label><input class="i" id="s-wanum" type="tel" value="${esc(S.waBusinessPhone || '')}"></div></div>
      <p class="small muted" style="margin:0">Les messages partent du WhatsApp installé sur ce téléphone : installez-y WhatsApp Business avec ce numéro.</p>
      <b style="margin-top:6px">🎁 Fidélité</b>
      <div class="grid2"><div><label class="f">Récompense toutes les … commandes (0 = désactivé)</label><input class="i" id="s-lev" type="number" min="0" value="${S.loyaltyEvery}"></div>
        <div><label class="f">Récompense</label><div class="row"><input class="i grow" id="s-lval" type="number" min="0" value="${S.loyaltyValue}"><select class="i" id="s-ltype" style="width:auto"><option value="percent" ${S.loyaltyType !== 'amount' ? 'selected' : ''}>%</option><option value="amount" ${S.loyaltyType === 'amount' ? 'selected' : ''}>F</option></select></div></div></div>
      <p class="small muted" style="margin:0">Ex. 10 commandes et 100 % = la 10e commande est offerte ; 5 et 20 % = 20 % de remise toutes les 5 commandes.</p>
      <div><label class="f">Code administrateur (protège bilan, dépenses, réglages, marges). Vide = pas de code.</label><input class="i" id="s-pin" inputmode="numeric" value="${esc(S.adminPin)}" placeholder="ex. 2580"></div>
      <button class="btn primary block" id="s-save">Enregistrer les réglages</button></div>
    <h2>Grille d'articles</h2>
    <p class="small muted" style="margin-top:0">Les anciennes factures gardent leurs prix : changer un tarif ne les modifie pas.</p>
    <div id="a-list">${arts.map((a, i) => `<div class="card stack" data-id="${a.id}">
        <div class="row"><input class="i grow" data-f="name" value="${esc(a.name)}"><button class="btn sm ghost" data-mv="-1" ${i === 0 ? 'disabled' : ''}>↑</button><button class="btn sm ghost" data-mv="1" ${i === arts.length - 1 ? 'disabled' : ''}>↓</button></div>
        <div class="grid2"><div><label class="f">Prix (F)</label><input class="i" type="number" data-f="price" value="${a.price}"></div>
          <div><label class="f">Poids (kg)</label><input class="i" type="number" step="0.05" data-f="weight" value="${a.weight}"></div></div>
        <div class="row between"><label class="check"><input type="checkbox" data-f="homeWash" ${a.homeWash ? 'checked' : ''}> Lavage maison</label>
          <label class="check"><input type="checkbox" data-f="active" ${a.active ? 'checked' : ''}> Actif</label>
          <button class="btn sm danger" data-adel>✕</button></div></div>`).join('')}</div>
    <div class="btns"><button class="btn" id="a-add">+ Ajouter un article</button><button class="btn primary" id="a-save">Enregistrer la grille</button></div>`);
  $('#s-logo', v).onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    S.logo = await L.resizeImage(f, 600, 0.88); await db.kv('logoRemoved', false); await L.saveSettings(S); toast('Logo enregistré'); routes.settings();
  };
  if ($('#s-nologo', v)) $('#s-nologo', v).onclick = async () => { S.logo = ''; await db.kv('logoRemoved', true); await L.saveSettings(S); routes.settings(); };
  $('#s-save', v).onclick = async () => {
    const pin = $('#s-pin', v).value.trim();
    if (pin && pin.length < 4) { toast('Le code doit avoir au moins 4 chiffres', true); return; }
    Object.assign(S, {
      name: $('#s-name', v).value.trim() || 'Smart Pressing', city: $('#s-city', v).value.trim(), phone: $('#s-phone', v).value.trim(),
      cousinRate: Number($('#s-rate', v).value) || 0, deliveryFee: Number($('#s-deliv', v).value) || 0,
      savingsPercent: Number($('#s-sav', v).value) || 0, invoiceStart: Number($('#s-start', v).value) || 1, adminPin: pin,
      dueDays: Math.max(0, Number($('#s-due', v).value) || 0), loyaltyEvery: Math.max(0, Number($('#s-lev', v).value) || 0),
      loyaltyValue: Math.max(0, Number($('#s-lval', v).value) || 0), loyaltyType: $('#s-ltype', v).value,
      monthlyReport: $('#s-mr', v).checked,
      waApp: $('#s-waapp', v).value, waBusinessPhone: $('#s-wanum', v).value.trim(),
    });
    if (pin) unlocked = true;
    await L.saveSettings(S); toast('Réglages enregistrés');
    scheduleMonthlyReminder(S.monthlyReport !== false);
  };
  const collect = () => $$('#a-list [data-id]', v).map((card, i) => ({
    id: Number(card.dataset.id), position: i,
    name: $('[data-f=name]', card).value.trim(), price: Number($('[data-f=price]', card).value) || 0,
    weight: Number($('[data-f=weight]', card).value) || 0, homeWash: $('[data-f=homeWash]', card).checked, active: $('[data-f=active]', card).checked,
  }));
  const saveGrid = async () => { for (const a of collect()) { if (a.name) await db.put('articles', a); } };
  $('#a-list', v).onclick = async (e) => {
    const card = e.target.closest('[data-id]'); if (!card) return;
    if (e.target.closest('[data-adel]')) {
      if (!(await ask({ title: 'Supprimer cet article ?', text: 'Les anciennes factures ne changent pas. Vous pouvez aussi simplement le décocher « Actif ».', ok: 'Supprimer', danger: true }))) return;
      await saveGrid(); await db.del('articles', Number(card.dataset.id)); routes.settings(); return;
    }
    const mv = e.target.closest('[data-mv]');
    if (mv) {
      const d = Number(mv.dataset.mv);
      if (d < 0 && card.previousElementSibling) card.parentNode.insertBefore(card, card.previousElementSibling);
      if (d > 0 && card.nextElementSibling) card.parentNode.insertBefore(card.nextElementSibling, card);
      await saveGrid(); routes.settings();
    }
  };
  $('#a-add', v).onclick = async () => {
    await saveGrid();
    await db.put('articles', { name: 'Nouvel article', price: 500, weight: 0.3, homeWash: false, active: true, position: arts.length });
    await routes.settings(); window.scrollTo(0, document.body.scrollHeight);
  };
  $('#a-save', v).onclick = async () => { await saveGrid(); toast('Grille enregistrée'); };
};

async function restoreFrom(file) {
  if (!file) return;
  let data;
  try { data = JSON.parse(await file.text()); } catch (e) { toast('Fichier illisible', true); return; }
  const n = (data.orders || []).length;
  if (!(await ask({ title: 'Restaurer cette sauvegarde ?', text: `Du ${fmtDate(data.exportedAt)} : ${n} facture(s), ${(data.expenses || []).length} dépense(s). Les données actuelles de ce téléphone seront remplacées.`, ok: 'Restaurer', danger: true }))) return;
  try { await L.importAll(data); toast('Sauvegarde restaurée'); location.hash = '#/home'; await boot(); }
  catch (e) { toast(e.message, true); }
}

// ---------------------------------------------------------------- sauvegarde en ligne
function cloudForm(c) {
  return `<div><label class="f">Adresse du projet Supabase</label><input class="i" id="cl-url" placeholder="https://xxxx.supabase.co" value="${esc(c.url)}" autocomplete="off" autocapitalize="off"></div>
    <div><label class="f">Clé « anon public »</label><input class="i" id="cl-key" placeholder="eyJhbGciOi…" value="${esc(c.key)}" autocomplete="off" autocapitalize="off"></div>
    <div><label class="f">Mot de passe des sauvegardes (6 caractères min.) — notez-le bien !</label><input class="i" id="cl-pass" type="password" value="${esc(c.password)}" autocomplete="off"></div>`;
}
function readCloudForm(root, prev = {}) {
  return { ...prev, url: Cloud.normalizeUrl($('#cl-url', root).value), key: $('#cl-key', root).value.trim().replace(/\s+/g, ''), password: $('#cl-pass', root).value };
}
async function pickAndRestore(c, after) {
  let list;
  try { list = await Cloud.listBackups(c); } catch (e) { toast(e.message, true); return; }
  if (!list.length) { toast('Aucune sauvegarde en ligne trouvée.', true); return; }
  const m = await ask({ title: 'Restaurer depuis internet', ok: 'Restaurer', danger: true,
    body: `<label class="f">Sauvegarde</label><select class="i" id="m-file">${list.map((f) => `<option value="${f.name}">${fmtDate(f.date, false)}${f.size ? ` · ${Math.round(f.size / 1024)} Ko` : ''}</option>`).join('')}</select>
      <p class="small muted" style="margin-top:8px">Les données actuelles de ce téléphone seront remplacées.</p>` });
  if (!m) return;
  try { await Cloud.restoreFromCloud(c, $('#m-file', m).value, c.password); toast('Données restaurées'); after && after(); }
  catch (e) { toast(e.message, true); }
}

routes.cloud = async () => {
  setNav('none');
  setTop({ title: 'Restaurer depuis internet', back: '#/welcome' });
  const v = view(`<div class="card stack"><p style="margin:0">Entrez les informations de votre sauvegarde en ligne (les mêmes que sur l'ancien téléphone).</p>
    ${cloudForm({ url: '', key: '', password: '' })}
    <button class="btn primary big block" id="cl-go">Voir mes sauvegardes</button></div>`);
  $('#cl-go', v).onclick = (e) => busy(e.currentTarget, async () => {
    const c = { ...readCloudForm(v), enabled: true };
    await pickAndRestore(c, async () => { await Cloud.setCloud(c); location.hash = '#/home'; await boot(); });
  });
};

routes.backup = async () => {
  setNav('more');
  setTop({ title: 'Sauvegarde', back: '#/more' });
  const last = await db.kv('lastBackup');
  const cloud = await Cloud.getCloud();
  const cloudLast = (await db.kv('cloudLast')) || {};
  const cloudOk = await db.kv('cloudLastOk');
  const [no, ne, np] = [await db.count('orders'), await db.count('expenses'), await db.count('photos')];
  const v = view(`<div class="card stack">
      <p style="margin:0">Toutes les données sont <b>uniquement dans ce téléphone</b>. S'il est perdu, cassé ou si l'appli est désinstallée, elles disparaissent.
      Faites une sauvegarde chaque semaine et envoyez-la ailleurs (WhatsApp à vous-même, Google Drive, e-mail).</p>
      <p class="small muted" style="margin:0">Contenu : ${no} facture(s), ${ne} dépense(s), ${np} photo(s).<br>Dernière sauvegarde : <b>${last ? fmtDate(last) : 'jamais'}</b></p>
      <button class="btn primary big block" id="b-share">Créer et envoyer la sauvegarde</button>
      <button class="btn block" id="b-save">Enregistrer dans le téléphone</button>
    </div>
    <div class="card stack" id="b-cloud"><b>☁️ Sauvegarde automatique en ligne</b>
      ${cloud.enabled ? `<p style="margin:0">✅ Activée : chaque soir à partir de 19 h, dès que l'appli est ouverte avec internet.</p>` : `<p style="margin:0" class="small">Chaque soir, la sauvegarde part toute seule sur internet (Supabase, gratuit), chiffrée avec votre mot de passe. Si le téléphone est perdu, tout se récupère sur un nouveau.</p>`}
      ${cloudLast.at ? `<p class="small ${cloudLast.ok === false ? '' : 'muted'}" style="margin:0;${cloudLast.ok === false ? 'color:var(--red)' : ''}">${cloudLast.ok === false ? `⚠️ Échec le ${fmtDate(cloudLast.at)} : ${esc(cloudLast.error || '')}` : `Dernier envoi : ${fmtDate(cloudLast.at)}`}${cloudOk && cloudLast.ok === false ? ` · dernier envoi réussi : ${fmtDate(cloudOk)}` : ''}</p>` : ''}
      ${cloud.enabled ? `<div class="btns"><button class="btn green" id="cl-now">Envoyer maintenant</button><button class="btn" id="cl-restore">Restaurer…</button></div>
        <details><summary class="small muted">Modifier la configuration</summary><div class="stack" style="margin-top:10px">${cloudForm(cloud)}
        <div class="btns"><button class="btn primary" id="cl-save">Enregistrer</button><button class="btn danger" id="cl-off">Désactiver</button></div></div></details>`
      : `${isAdmin() ? `${cloudForm(cloud)}<button class="btn primary block" id="cl-save">Tester et activer</button>
        <details class="guide"><summary>Comment faire ? (une seule fois, 5 minutes)</summary><ol>
          <li>Sur <b>supabase.com</b>, créez un compte gratuit puis <b>New project</b> (nom : pressing ; région : Europe).</li>
          <li>Menu <b>Storage</b> → <b>New bucket</b> → nom : <code>sauvegardes</code> (laissez « Public » décoché).</li>
          <li>Menu <b>SQL Editor</b> → collez le code ci-dessous → <b>Run</b>.<br><button class="btn sm" id="cl-sql" type="button">Copier le code</button></li>
          <li>Menu <b>Project Settings → API Keys</b> : copiez l'<b>adresse du projet</b> (Project URL) et la clé <b>anon public</b> (ou <b>publishable</b>).</li>
          <li>Collez-les ici, choisissez un mot de passe, puis <b>Tester et activer</b>.</li></ol>
          <p class="small muted">Gardez le mot de passe et ces informations sur papier : ils seront demandés pour restaurer sur un nouveau téléphone.</p></details>` : '<p class="small muted" style="margin:0">Déverrouillez le mode admin pour l’activer.</p>'}`}
    </div>
    <div class="card stack"><b>Restaurer</b>
      <p class="small muted" style="margin:0">Pour un nouveau téléphone : installez l'appli, puis choisissez le fichier de sauvegarde (.json).</p>
      <label class="btn ghost block">Choisir un fichier de sauvegarde<input type="file" accept=".json,application/json,text/plain" id="b-file" hidden></label></div>`);
  const make = async () => {
    const data = await L.exportAll();
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
    const name = `SmartPressing-sauvegarde-${L.nowIso().slice(0, 16).replace(/[T:]/g, '-')}.json`;
    return { blob, name };
  };
  $('#b-share', v).onclick = (e) => busy(e.currentTarget, async () => {
    const { blob, name } = await make();
    const r = await shareFile(blob, name, 'Sauvegarde Smart Pressing');
    if (r !== 'cancelled') { await db.kv('lastBackup', L.nowIso()); toast('Sauvegarde créée'); routes.backup(); }
  });
  $('#b-save', v).onclick = (e) => busy(e.currentTarget, async () => {
    const { blob, name } = await make();
    const where = await saveFile(blob, name);
    await db.kv('lastBackup', L.nowIso());
    toast(where ? 'Enregistré : ' + where : 'Sauvegarde créée'); routes.backup();
  });
  $('#b-file', v).onchange = (e) => restoreFrom(e.target.files[0]);
  if ($('#cl-save', v)) $('#cl-save', v).onclick = (e) => busy(e.currentTarget, async () => {
    if (needAdmin('backup')) return;
    const c = readCloudForm(v, cloud);
    if (!/^(https:\/\/|http:\/\/localhost)/.test(c.url) || !c.key) throw new Error('Adresse ou clé manquante.');
    if ((c.password || '').length < 6) throw new Error('Mot de passe : 6 caractères minimum.');
    if (/^sb_secret_/.test(c.key) || /service_role/.test(c.key)) throw new Error('Cette clé est la clé SECRÈTE : prenez la clé « publishable » (sb_publishable_…) ou « anon ».');
    await Cloud.backupNow(c);
    await Cloud.setCloud({ ...c, enabled: true });
    toast('Sauvegarde en ligne activée ✔'); routes.backup();
  });
  if ($('#cl-sql', v)) $('#cl-sql', v).onclick = async () => {
    try { await navigator.clipboard.writeText(Cloud.SETUP_SQL); toast('Code copié'); }
    catch (e) { await ask({ title: 'Code à coller dans Supabase', ok: 'OK', body: `<textarea class="i" rows="7" style="font-size:.75rem">${esc(Cloud.SETUP_SQL)}</textarea>` }); }
  };
  if ($('#cl-now', v)) $('#cl-now', v).onclick = (e) => busy(e.currentTarget, async () => { await Cloud.backupNow(); toast('Sauvegarde envoyée ✔'); routes.backup(); });
  if ($('#cl-restore', v)) $('#cl-restore', v).onclick = () => pickAndRestore(cloud, async () => { location.hash = '#/home'; await boot(); });
  if ($('#cl-off', v)) $('#cl-off', v).onclick = async () => {
    if (needAdmin('backup')) return;
    if (!(await ask({ title: 'Désactiver la sauvegarde en ligne ?', ok: 'Désactiver', danger: true }))) return;
    await Cloud.setCloud({ ...cloud, enabled: false }); routes.backup();
  };
};

// ---------------------------------------------------------------- routeur
// Un seul écran se dessine à la fois : si on change d'écran pendant un chargement, le dernier demandé gagne.
let rendering = null, renderAgain = false;
async function render() {
  if (rendering) { renderAgain = true; return rendering; }
  rendering = (async () => { do { renderAgain = false; await renderNow(); } while (renderAgain); })();
  try { await rendering; } finally { rendering = null; }
}

async function renderNow() {
  try { REG = await L.getClientsReg(); } catch (e) { REG = []; }
  if (cleanup) { try { cleanup(); } catch (e) {} cleanup = null; }
  const raw = location.hash.replace(/^#\/?/, '') || 'home';
  const [path, qs] = raw.split('?');
  const [name, arg, arg2] = path.split('/');
  const q = new URLSearchParams(qs || '');
  if (!connected) { await routes.login(); return; }
  if (!(await L.isInitialized()) && name !== 'welcome' && name !== 'cloud') { location.hash = '#/welcome'; return; }
  const fn = routes[name] || routes.home;
  try { await fn(arg, q, arg2); }
  catch (e) { console.error(e); view(`<div class="flash err">Erreur : ${esc(e.message)}</div>`); }
}

// Logo par défaut (fourni avec l'appli) tant qu'aucun autre n'est choisi dans Réglages.
async function defaultLogo() {
  try {
    const blob = await (await fetch('img/logo.jpg')).blob();
    return await new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => res(''); r.readAsDataURL(blob); });
  } catch (e) { return ''; }
}

let autoTimer = null;
function startAutoBackup() {
  const run = () => Cloud.autoBackup((ok) => { if (ok) toast('☁️ Sauvegarde du soir envoyée'); });
  if (!autoTimer) {
    autoTimer = setInterval(run, 15 * 60e3);
    window.addEventListener('online', run);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) run(); });
  }
  setTimeout(run, 4000);
}

async function boot() {
  S = await L.getSettings();
  if (await L.isInitialized()) {
    await L.migrateClients();
    await L.migrateVolumePromo();
    S = await L.getSettings();
    startAutoBackup();
    if (isNative && !(await db.kv('reminderScheduled'))) { if (await scheduleMonthlyReminder(S.monthlyReport !== false)) await db.kv('reminderScheduled', true); }
  }
  if (!S.logo && !(await db.kv('logoRemoved'))) {
    const d = await defaultLogo();
    if (d) { S.logo = d; if (await L.isInitialized()) await L.saveSettings(S); }
  }
  await render();
}

window.addEventListener('hashchange', async () => { const logo = S && S.logo; S = await L.getSettings(); if (!S.logo && logo && !(await db.kv('logoRemoved'))) { S.logo = logo; if (await L.isInitialized()) await L.saveSettings(S); } render(); });
// Bouton retour Android : revenir en arrière dans l'appli plutôt que la fermer.
if (isNative && window.Capacitor.registerPlugin) {
  try {
    const App = window.Capacitor.registerPlugin('App');
    App.addListener('backButton', () => {
      const h = location.hash;
      if (!h || h === '#/home' || h === '#/welcome') App.exitApp(); else history.back();
    });
  } catch (e) {}
}
boot();
