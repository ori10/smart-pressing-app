import { db } from './db.js';
import * as L from './logic.js';
import { invoicePdf, labelsPdf } from './pdf.js';
import { shareFile, saveFile, openExternal, waNumber, isNative } from './native.js';
import { startCamera, stopCamera, beep } from './scan.js';

const { STATUS, STATUS_LABEL, STATUS_TONE, money, fmtDate, fmtShort, orderTotals, pieceCode, orderCode } = L;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let S = null;            // réglages en cache
let unlocked = false;    // mode administrateur déverrouillé (jusqu'à fermeture de l'appli)
let cleanup = null;      // fonction appelée en quittant un écran (caméra…)
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
  const logo = !back && S.logo ? `<img class="logo" src="${S.logo}" alt="">` : '';
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

function ask({ title, text = '', ok = 'Confirmer', cancel = 'Annuler', danger = false, body = '' }) {
  return new Promise((resolve) => {
    const bg = document.createElement('div');
    bg.className = 'modal-bg';
    bg.innerHTML = `<div class="modal"><h3>${esc(title)}</h3>${text ? `<p>${esc(text)}</p>` : ''}${body}
      <div class="btns" style="margin-top:12px"><button class="btn ghost" data-r="0">${esc(cancel)}</button>
      <button class="btn ${danger ? 'danger' : 'primary'}" data-r="1">${esc(ok)}</button></div></div>`;
    document.body.appendChild(bg);
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
function orderCard(o, { showAction = true } = {}) {
  const t = orderTotals(o);
  const act = L.nextAction(o);
  return `<div class="card edge ${STATUS_TONE[o.status]}">
    <div class="row between"><a href="#/order/${o.number}" style="text-decoration:none;color:inherit" class="grow"><b>N°${o.number} · ${esc(o.clientName)}</b></a>${badge(o)}</div>
    ${steps(o)}
    <div class="small muted">${esc(L.itemsSummary(o))}</div>
    <div class="row between" style="margin-top:6px"><span class="small">${t.pieces} pièce(s)${o.deliveryAt ? ' · livraison ' + fmtShort(o.deliveryAt) : ''}</span>
      <b>${money(t.total)}${o.paid ? '' : ' <span class="badge red">impayé</span>'}</b></div>
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
  let paid = o.paid;
  if (!o.paid) {
    if (cashedChecked === null) {
      const m = await ask({
        title: `Livrer la commande N°${o.number} ?`, ok: 'Livré',
        body: `<p>Montant : <b>${money(t.total)}</b></p><label class="check"><input type="checkbox" id="m-paid"> Argent encaissé</label>`,
      });
      if (!m) return false;
      paid = $('#m-paid', m).checked;
    } else paid = cashedChecked;
    if (!paid && !(await ask({ title: 'Pas encore payé ?', text: 'La commande sera livrée mais restera dans les impayés.', ok: 'Livrer quand même' }))) return false;
  }
  o.paid = paid;
  await L.advance(o, STATUS.LIVRE, paid ? '' : 'Livré non payé');
  toast(`N°${o.number} livrée`);
  return true;
}

// ---------------------------------------------------------------- écrans
const routes = {};

routes.welcome = async () => {
  setNav('none');
  setTop({ title: 'Bienvenue' });
  const v = view(`<div class="welcome">
    <div class="mark">SP</div>
    <h1>Smart Pressing</h1>
    <p class="muted">Toutes vos données restent dans ce téléphone.<br>Pas besoin d'internet.</p></div>
    <div class="card stack">
      <button class="btn primary big block" id="w-hist">Reprendre mes données</button>
      <p class="small muted" style="margin:0">Réglages, ${'11'} articles et les factures déjà émises (N°19 et N°20).</p>
      <button class="btn ghost block" id="w-empty">Démarrer avec seulement la grille de prix</button>
      <label class="btn ghost block">Restaurer une sauvegarde…<input type="file" accept="application/json,.json" id="w-file" hidden></label>
    </div>`);
  $('#w-hist', v).onclick = async () => { await L.initialize(true); location.hash = '#/home'; boot(); };
  $('#w-empty', v).onclick = async () => { await L.initialize(false); location.hash = '#/home'; boot(); };
  $('#w-file', v).onchange = (e) => restoreFrom(e.target.files[0]);
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
  if (total > 0) {
    const days = last ? Math.floor((Date.now() - new Date(last).getTime()) / 864e5) : null;
    if (days === null || days >= 7) backupNote = `<a href="#/backup" class="note" style="display:block;text-decoration:none;margin-bottom:12px">⚠️ ${days === null ? 'Aucune sauvegarde faite.' : `Dernière sauvegarde il y a ${days} jours.`} Toutes les données sont dans ce téléphone : faites une sauvegarde.</a>`;
  }
  const now = new Date();
  const hello = now.getHours() < 18 ? 'Bonjour' : 'Bonsoir';
  view(`<h1>${hello} 👋</h1>
    <p class="muted" style="margin:4px 0 14px">${fmtDate(L.todayIso(), false)} · ${c.open} commande(s) en cours</p>
    ${backupNote}
    <a class="btn primary big block" href="#/new" style="margin-bottom:14px">+ Nouvelle facture</a>
    <div class="tiles">
      <a class="tile orange" href="#/orders?s=0"><b>${c.byStatus[0]}</b><span>À envoyer au cousin</span></a>
      <a class="tile blue" href="#/orders?s=1"><b>${c.byStatus[1]}</b><span>Chez le cousin</span></a>
      <a class="tile orange" href="#/ironing"><b>${c.byStatus[2]}</b><span>À repasser</span></a>
      <a class="tile orange" href="#/orders?s=3"><b>${c.byStatus[3]}</b><span>À vérifier</span></a>
      <a class="tile green" href="#/deliveries"><b>${c.byStatus[4]}</b><span>Prêtes</span></a>
      <a class="tile navy" href="#/orders?s=today"><b>${c.todayCount}</b><span>Factures du jour</span></a>
      ${isAdmin() ? `<a class="tile navy wide" href="#/bilan"><b>${money(c.todayCA)}</b><span>Chiffre d'affaires du jour</span></a>` : ''}
    </div>`);
};

routes.new = async () => {
  setNav('plus');
  const number = await L.nextNumber();
  setTop({ title: 'Nouvelle facture', right: `<span class="pill">N°${number}</span>` });
  const arts = await L.getArticles(true);
  const qty = {};
  const v = view(`<div class="card">
      <div class="grid2">
        <div><label class="f">Nom du client</label><input class="i" id="n-name" autocomplete="off" autocapitalize="words"></div>
        <div><label class="f">Téléphone</label><input class="i" id="n-phone" type="tel" inputmode="tel"></div>
      </div></div>
    <div class="card" id="n-arts">${arts.map((a) => `<div class="art" data-id="${a.id}">
        <div class="name">${esc(a.name)}<div class="price">${money(a.price)}${a.homeWash ? ' · lavage maison' : ''}</div></div>
        <div class="qty"><button class="minus" data-d="-1">−</button><output>0</output><button class="plus" data-d="1">+</button></div></div>`).join('') || '<div class="empty">Aucun article actif : ajoutez-en dans Réglages.</div>'}</div>
    <div class="card stack">
      <div><label class="f">Poids pesé (kg) — facultatif</label><input class="i" id="n-kg" type="number" inputmode="decimal" step="0.1" min="0" placeholder="estimé : 0 kg"></div>
      <label class="check"><input type="checkbox" id="n-deliv"> Livraison (+${money(S.deliveryFee)})</label>
      <div id="n-dbox" class="hidden stack">
        <div><label class="f">Lieu de livraison</label><input class="i" id="n-place"></div>
        <div><label class="f">Date et heure</label><input class="i" id="n-at" type="datetime-local"></div>
      </div>
    </div>
    <div class="totalbar">
      <div class="row between"><span>Total client</span><span class="big" id="n-total">0 F</span></div>
      <div class="small" id="n-admin" style="opacity:.85"></div>
      <button class="btn primary big block" id="n-go" style="margin-top:10px">Émettre la facture</button>
    </div>`);
  const recalc = () => {
    let items = 0, est = 0, n = 0;
    for (const a of arts) { const q = qty[a.id] || 0; items += q * a.price; if (!a.homeWash) est += q * a.weight; n += q; }
    const deliv = $('#n-deliv', v).checked ? Number(S.deliveryFee) || 0 : 0;
    const kgv = $('#n-kg', v).value;
    const washKg = kgv !== '' ? Number(kgv) : est;
    const wash = Math.round(washKg * S.cousinRate);
    $('#n-kg', v).placeholder = `estimé : ${L.kg(est)}`;
    $('#n-total', v).textContent = money(items + deliv);
    $('#n-admin', v).textContent = (n ? `${n} pièce(s)` : '') + (isAdmin() && n ? ` · Lavage ${money(wash)} · marge ${money(items + deliv - wash)}` : '');
  };
  $('#n-arts', v).addEventListener('click', (e) => {
    const b = e.target.closest('button[data-d]'); if (!b) return;
    const row = b.closest('.art'); const id = Number(row.dataset.id);
    qty[id] = Math.max(0, (qty[id] || 0) + Number(b.dataset.d));
    $('output', row).textContent = qty[id];
    row.classList.toggle('on', qty[id] > 0);
    recalc();
  });
  $('#n-kg', v).oninput = recalc;
  $('#n-deliv', v).onchange = () => { $('#n-dbox', v).classList.toggle('hidden', !$('#n-deliv', v).checked); recalc(); };
  $('#n-go', v).onclick = (e) => busy(e.currentTarget, async () => {
    const o = await L.createOrder({
      clientName: $('#n-name', v).value, clientPhone: $('#n-phone', v).value, quantities: qty,
      weighedKg: $('#n-kg', v).value, delivery: $('#n-deliv', v).checked,
      deliveryPlace: $('#n-place', v).value, deliveryAt: $('#n-at', v).value,
    });
    toast(`Facture N°${o.number} émise`);
    location.hash = `#/order/${o.number}`;
  });
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
  const v = view(`
    ${act ? `<button class="btn primary big block" id="o-act" style="margin-bottom:12px">${esc(act.label)}</button>` : ''}
    <div class="card">
      <div class="row between"><div><b style="font-size:1.1rem">${esc(o.clientName)}</b>
        <div class="small muted">${o.clientPhone ? `<a href="tel:${esc(o.clientPhone)}">${esc(o.clientPhone)}</a> · ` : ''}${fmtDate(o.createdAt)}</div></div>
        <span class="badge ${o.paid ? 'green' : 'red'}">${o.paid ? 'Payé' : 'Impayé'}</span></div>
      ${steps(o)}
      <div class="inv-lines">
        ${o.items.map((i) => `<div class="l"><span>${i.qty} × ${esc(i.name)}</span><span>${money(i.qty * i.price)}</span></div>`).join('')}
        ${o.deliveryFee ? `<div class="l"><span>Livraison</span><span>${money(o.deliveryFee)}</span></div>` : ''}
        <div class="l total"><span>Total</span><span>${money(t.total)}</span></div>
      </div>
      ${o.deliveryPlace || o.deliveryAt ? `<p class="small" style="margin:6px 0 0">🚚 ${esc(o.deliveryPlace || 'Lieu à préciser')}${o.deliveryAt ? ' · ' + fmtShort(o.deliveryAt) : ''}</p>` : ''}
      <div class="barcode"><svg id="o-bc"></svg></div>
    </div>
    ${o.note ? `<div class="note" style="margin-bottom:12px">Remarque : ${esc(o.note)}</div>` : ''}
    <div class="btns" style="margin-bottom:12px">
      <button class="btn navy" id="o-share">Envoyer le PDF</button>
      <button class="btn" id="o-dl">Télécharger</button>
      <button class="btn" id="o-labels">Étiquettes</button>
      <button class="btn ${o.paid ? 'ghost' : 'green'}" id="o-paid">${o.paid ? 'Marquer impayé' : 'Marquer payé'}</button>
      ${o.clientPhone ? `<button class="btn" id="o-wa">WhatsApp</button>` : ''}
    </div>
    ${isAdmin() ? `<div class="card"><h2 style="margin-top:0">Coûts (admin)</h2>
      <div class="calc"><div class="l"><span>Poids ${o.weighedKg != null ? 'pesé' : 'estimé'}</span><span>${L.kg(t.washKg)}</span></div>
      <div class="l"><span>Lavage cousin (${money(o.cousinRate)}/kg)</span><span>− ${money(t.wash)}</span></div>
      <div class="l sum"><span>Marge</span><span>${money(t.margin)}</span></div></div>
      <div class="row" style="margin-top:10px"><input class="i grow" id="o-kg" type="number" inputmode="decimal" step="0.1" placeholder="Poids pesé (kg)" value="${o.weighedKg ?? ''}"><button class="btn sm" id="o-kgsave">Enregistrer</button></div>
    </div>` : ''}
    <h2>Photos des pièces</h2>
    <div class="card">${o.pieces.map((p) => {
      const code = pieceCode(o.number, p.index); const ph = photos[p.index];
      return `<div class="piece">${ph ? `<img class="thumb" src="${ph}" data-full="${p.index}">` : '<div class="thumb">—</div>'}
        <div class="grow"><code>${code}</code><div class="small">${esc(p.name)}${p.homeWash ? ' · maison' : ''}</div></div>
        <label class="btn sm">${ph ? 'Refaire' : 'Photo'}<input type="file" accept="image/*" capture="environment" data-photo="${p.index}" hidden></label></div>`;
    }).join('')}</div>
    <h2>Historique</h2>
    <div class="card timeline">${o.events.slice().reverse().map((e) => `<div class="ev"><span class="dot"></span><div><b>${esc(e.note && e.status === 0 ? e.note : STATUS_LABEL[e.status])}</b>${e.note && e.status !== 0 ? ' · ' + esc(e.note) : ''}<div class="small muted">${fmtDate(e.at)}</div></div></div>`).join('')}</div>
    ${isAdmin() ? `<button class="btn danger block" id="o-del" style="margin-top:6px">Supprimer cette facture</button>` : ''}
  `);
  try { window.JsBarcode('#o-bc', orderCode(o.number), { format: 'CODE128', height: 55, width: 2, fontSize: 16, margin: 0 }); } catch (e) {}
  const reload = () => routes.order(number);
  if (act) $('#o-act', v).onclick = (e) => busy(e.currentTarget, () => runAction(o.number, reload));
  const pdfName = `Facture-${o.number}-${fileSafe(o.clientName)}.pdf`;
  $('#o-share', v).onclick = (e) => busy(e.currentTarget, async () => {
    const blob = await invoicePdf(o, S);
    const r = await shareFile(blob, pdfName, `Facture N°${o.number}`);
    if (r === 'downloaded' && o.clientPhone) openExternal(`https://wa.me/${waNumber(o.clientPhone)}?text=${encodeURIComponent(waText(o))}`);
  });
  $('#o-dl', v).onclick = (e) => busy(e.currentTarget, async () => {
    const where = await saveFile(await invoicePdf(o, S), pdfName);
    if (where) toast('Enregistré : ' + where);
  });
  $('#o-labels', v).onclick = (e) => busy(e.currentTarget, async () => {
    await shareFile(labelsPdf(o, S), `Etiquettes-${o.number}.pdf`, `Étiquettes N°${o.number}`);
  });
  $('#o-paid', v).onclick = async () => {
    o.paid = !o.paid;
    o.events.push({ status: o.status, note: o.paid ? 'Paiement reçu' : 'Marqué impayé', at: L.nowIso() });
    await L.saveOrder(o); toast(o.paid ? 'Marqué payé' : 'Marqué impayé'); reload();
  };
  if ($('#o-wa', v)) $('#o-wa', v).onclick = () => openExternal(`https://wa.me/${waNumber(o.clientPhone)}?text=${encodeURIComponent(waText(o))}`);
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

function waText(o) {
  const t = orderTotals(o);
  const base = `Bonjour ${o.clientName}, ${S.name} : facture N°${o.number}, ${t.pieces} pièce(s), total ${money(t.total)}.`;
  if (o.status === STATUS.PRET) return base + ' Votre linge est prêt.';
  return base + ' Merci de votre confiance !';
}

routes.orders = async (_, q) => {
  setNav('list');
  setTop({ title: 'Commandes' });
  const filter = q.get('s') ?? 'open';
  const all = await L.allOrders();
  const chips = [['open', 'En cours'], ...STATUS_LABEL.map((l, i) => [String(i), l]), ['unpaid', 'Impayées'], ['today', 'Du jour'], ['all', 'Toutes']];
  const v = view(`<form class="row" id="s-form" style="margin-bottom:10px"><input class="i grow" id="s-q" placeholder="Code PR…, nom, téléphone, N°" autocomplete="off" value="${esc(q.get('q') || '')}"><button class="btn navy">Chercher</button></form>
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
      <div class="progress" style="margin-top:10px"><i id="v-bar"></i></div></div>
    <button class="btn navy big block" id="v-cam">📷 Scanner avec la caméra</button>
    <div class="scanbox hidden" id="v-box" style="margin-top:10px"><video id="v-video" muted playsinline></video></div>
    <form class="row" id="v-form" style="margin-top:10px"><input class="i grow" id="v-input" placeholder="Lecteur / saisie : PR${L.pad(o.number, 4)}-01" autocomplete="off" autocapitalize="characters"><button class="btn primary">OK</button></form>
    <div id="v-flash"></div>
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
    let nextMarked = false;
    $('#v-list', v).innerHTML = list.map((p) => {
      const ok = p.checks && p.checks[stage];
      const isNext = !ok && !nextMarked; if (isNext) nextMarked = true;
      return `<div class="piece ${ok ? 'ok' : ''} ${isNext ? 'next' : ''}"><span class="tick">${ok ? '✓' : ''}</span>
        <div class="grow"><b>${esc(p.name)}</b> <code>${pieceCode(o.number, p.index)}</code>${isNext ? '<div class="small muted">← à scanner</div>' : ''}</div>
        ${photos[p.index] ? `<img class="thumb" src="${photos[p.index]}" data-full="1">` : ''}</div>`;
    }).join('') + (stage === 'cousin' && o.pieces.some((p) => p.homeWash) ? `<p class="small muted">Les pièces « lavage maison » ne sont pas demandées ici.</p>` : '');
    $$('[data-full]', v).forEach((img) => { img.onclick = () => showImage(img.src); });
    $('#v-ok', v).disabled = !L.stageComplete(o, stage);
  };
  let lastCode = '', lastAt = 0;
  const handle = async (raw) => {
    const code = String(raw).trim().toUpperCase();
    if (!code) return;
    if (code === lastCode && Date.now() - lastAt < 2500) return;
    lastCode = code; lastAt = Date.now();
    const r = await L.scanPiece(o, stage, code);
    beep(r.ok);
    $('#v-flash', v).innerHTML = `<div class="flash ${r.ok ? 'ok' : 'err'}">${r.ok ? '✔ ' : '✖ '}${esc(r.message)}</div>`;
    draw();
    if (r.ok && L.stageComplete(o, stage)) { toast('Toutes les pièces sont vérifiées'); stopCamera(); $('#v-box', v).classList.add('hidden'); }
  };
  $('#v-form', v).onsubmit = (e) => { e.preventDefault(); const i = $('#v-input', v); lastCode = ''; handle(i.value); i.value = ''; i.focus(); };
  $('#v-cam', v).onclick = async () => {
    const box = $('#v-box', v);
    if (!box.classList.contains('hidden')) { stopCamera(); box.classList.add('hidden'); return; }
    box.classList.remove('hidden');
    try { await startCamera($('#v-video', v), handle); }
    catch (e) { box.classList.add('hidden'); toast('Caméra indisponible : utilisez la saisie.', true); }
  };
  $('#v-gap', v).onclick = async () => {
    const n = $('#v-note', v).value; if (!n.trim()) return;
    await L.reportGap(o, n); $('#v-note', v).value = ''; toast('Écart enregistré');
  };
  $('#v-ok', v).onclick = (e) => busy(e.currentTarget, async () => {
    await L.advance(o, stage === 'cousin' ? STATUS.A_REPASSER : STATUS.PRET);
    stopCamera();
    toast(stage === 'cousin' ? 'Transmis au repassage' : 'Commande prête');
    location.hash = `#/order/${o.number}`;
  });
  cleanup = stopCamera;
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
        ${o.paid ? '<span class="badge green">Déjà payé</span>' : `À encaisser : <b>${money(t.total)}</b>`}</div>
      ${o.paid ? '' : `<label class="check"><input type="checkbox" data-cash="${o.number}"> Argent encaissé</label>`}
      <div class="btns"><button class="btn green" data-deliv="${o.number}">Livré</button>
      ${o.clientPhone ? `<button class="btn" data-wa="${o.number}">WhatsApp</button>` : '<span></span>'}</div></div>`;
  }).join('') || '<div class="empty">Aucune commande prête.</div>');
  v.onclick = async (e) => {
    const d = e.target.closest('[data-deliv]');
    if (d) {
      const o = await L.getOrder(d.dataset.deliv);
      const cb = $(`[data-cash="${o.number}"]`, v);
      if (await deliverFlow(o, o.paid ? null : cb.checked)) routes.deliveries();
      return;
    }
    const w = e.target.closest('[data-wa]');
    if (w) { const o = await L.getOrder(w.dataset.wa); openExternal(`https://wa.me/${waNumber(o.clientPhone)}?text=${encodeURIComponent(waText(o))}`); }
  };
};

routes.more = async () => {
  setNav('more');
  setTop({ title: 'Plus' });
  const lock = (t) => (S.adminPin && !unlocked ? `<span class="lock">🔒 ${t || ''}</span>` : '');
  const v = view(`<div class="card menu">
      <a href="#/ironing"><span class="ic">👕</span>Repassage</a>
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
  setTop({ title: 'Bilan', back: '#/more' });
  const kind = q.get('k') || 'month';
  const off = Number(q.get('o') || 0);
  const p = L.period(kind, off);
  const [orders, expenses] = [await db.all('orders'), await db.all('expenses')];
  const b = L.computeBilan(orders, expenses, p, S);
  const today = L.todayIso();
  let chart = '';
  if (kind === 'year') {
    const months = Array.from({ length: 12 }, (_, i) => `${p.start.slice(0, 4)}-${L.pad(i + 1)}`);
    const max = Math.max(1, ...months.map((m) => (b.byMonth[m] || {}).ca || 0));
    chart = `<div class="bars">${months.map((m) => `<div style="height:${(((b.byMonth[m] || {}).ca || 0) / max) * 100}%" title="${money((b.byMonth[m] || {}).ca)}"></div>`).join('')}</div>
      <div class="bars-x">${months.map((m) => `<span>${L.monthName(Number(m.slice(5)) - 1).slice(0, 3)}</span>`).join('')}</div>`;
  } else {
    const days = L.daysBetween(p.start, p.end);
    const max = Math.max(1, ...days.map((d) => b.byDay[d] || 0));
    chart = `<div class="bars">${days.map((d) => `<div class="${d === today ? 'today' : ''}" style="height:${((b.byDay[d] || 0) / max) * 100}%"></div>`).join('')}</div>
      <div class="bars-x">${days.map((d, i) => `<span>${kind === 'week' || i % 5 === 0 ? d.slice(8) : ''}</span>`).join('')}</div>`;
  }
  const yearTable = kind === 'year' ? `<div class="card"><h2 style="margin-top:0">Mois par mois</h2><table class="t"><tr><th>Mois</th><th>CA</th><th>Lavage</th><th>Dépenses</th><th>Net</th></tr>
    ${Array.from({ length: 12 }, (_, i) => { const m = `${p.start.slice(0, 4)}-${L.pad(i + 1)}`; const r = b.byMonth[m] || { ca: 0, wash: 0, exp: 0, inv: 0 };
      return `<tr><td>${L.monthName(i).slice(0, 4)}.</td><td>${money(r.ca)}</td><td>${money(r.wash)}</td><td>${money(r.exp + r.inv)}</td><td><b>${money(r.ca - r.wash - r.exp - r.inv)}</b></td></tr>`; }).join('')}</table></div>` : '';
  const maxArt = Math.max(1, ...b.topArticles.map((a) => a[1]));
  const v = view(`<div class="chips" style="margin-bottom:0">${[['week', 'Semaine'], ['month', 'Mois'], ['year', 'Année']].map(([k, l]) => `<a class="chip ${k === kind ? 'on' : ''}" href="#/bilan?k=${k}">${l}</a>`).join('')}</div>
    <div class="periodnav"><button data-o="${off - 1}">‹</button><div class="lbl">${p.label}</div><button data-o="${off + 1}" ${off >= 0 ? 'disabled style="opacity:.3"' : ''}>›</button></div>
    <div class="kpis"><div class="kpi"><span>Chiffre d'affaires</span><b>${money(b.ca)}</b></div><div class="kpi"><span>Encaissé</span><b>${money(b.cashed)}</b></div>
      <div class="kpi"><span>Commandes</span><b>${b.orders}</b></div><div class="kpi"><span>Impayés</span><b style="color:${b.unpaid ? 'var(--red)' : 'inherit'}">${money(b.unpaid)}</b></div></div>
    <div class="card" style="margin-top:12px"><b class="small muted">CA par ${kind === 'year' ? 'mois' : 'jour'}</b>${chart}</div>
    <div class="card calc">
      <div class="l"><span>Chiffre d'affaires (${b.orders} commandes)</span><span>${money(b.ca)}</span></div>
      <div class="l"><span>− Lavage chez le cousin (${L.kg(b.washKg)})</span><span>− ${money(b.wash)}</span></div>
      <div class="l sum"><span>= Marge après lavage</span><span>${money(b.margin)}</span></div>
      <div class="l"><span>− Dépenses courantes</span><span>− ${money(b.current)}</span></div>
      <div class="l net ${b.net < 0 ? 'neg' : ''}"><span>BÉNÉFICE NET</span><span>${money(b.net)}</span></div>
      <div class="l"><span>− Investissements</span><span>− ${money(b.invest)}</span></div>
      <div class="l sum"><span>Net après investissements</span><span>${money(b.netAfterInvest)}</span></div>
    </div>
    ${b.washRatio > 0.35 ? `<div class="alert" style="margin-bottom:12px">Le lavage représente ${Math.round(b.washRatio * 100)} % du CA (alerte au-dessus de 35 %). Vérifiez les prix ou le poids.</div>` : ''}
    <div class="kpis"><div class="kpi"><span>À payer au cousin</span><b>${money(b.wash)}</b><span>${L.kg(b.washKg)} × ${money(S.cousinRate)}</span></div>
      <div class="kpi"><span>À mettre de côté (${S.savingsPercent} %)</span><b>${money(b.savings)}</b><span>Lavage/CA ${Math.round(b.washRatio * 100)} %</span></div></div>
    ${yearTable}
    <div class="card" style="margin-top:12px"><h2 style="margin-top:0">Articles les plus lavés</h2>
      ${b.topArticles.map(([n, c]) => `<div class="hbar"><span class="lbl">${esc(n)}</span><span class="track"><i style="width:${(c / maxArt) * 100}%"></i></span><b>${c}</b></div>`).join('') || '<p class="muted small">Aucune commande sur la période.</p>'}</div>
    <a class="btn block" href="#/expenses">Voir et saisir les dépenses →</a>`);
  $$('[data-o]', v).forEach((btn) => { btn.onclick = () => { if (!btn.disabled) location.hash = `#/bilan?k=${kind}&o=${btn.dataset.o}`; }; });
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
      <div class="row">${S.logo ? `<img src="${S.logo}" style="width:64px;height:64px;border-radius:12px;object-fit:cover">` : '<div class="thumb" style="width:64px;height:64px;border-radius:12px;background:var(--bg);display:grid;place-items:center" >logo</div>'}
        <label class="btn sm">Choisir le logo<input type="file" accept="image/*" id="s-logo" hidden></label>${S.logo ? '<button class="btn sm ghost" id="s-nologo">Retirer</button>' : ''}</div>
      <div><label class="f">Nom</label><input class="i" id="s-name" value="${esc(S.name)}"></div>
      <div class="grid2"><div><label class="f">Ville</label><input class="i" id="s-city" value="${esc(S.city)}"></div>
        <div><label class="f">Téléphone</label><input class="i" id="s-phone" type="tel" value="${esc(S.phone)}"></div></div>
      <div class="grid2"><div><label class="f">Tarif du cousin (F/kg)</label><input class="i" id="s-rate" type="number" value="${S.cousinRate}"></div>
        <div><label class="f">Frais de livraison (F)</label><input class="i" id="s-deliv" type="number" value="${S.deliveryFee}"></div></div>
      <div class="grid2"><div><label class="f">% mis de côté</label><input class="i" id="s-sav" type="number" value="${S.savingsPercent}"></div>
        <div><label class="f">Premier N° de facture</label><input class="i" id="s-start" type="number" value="${S.invoiceStart}"></div></div>
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
    S.logo = await L.resizeImage(f, 400, 0.85); await L.saveSettings(S); toast('Logo enregistré'); routes.settings();
  };
  if ($('#s-nologo', v)) $('#s-nologo', v).onclick = async () => { S.logo = ''; await L.saveSettings(S); routes.settings(); };
  $('#s-save', v).onclick = async () => {
    const pin = $('#s-pin', v).value.trim();
    if (pin && pin.length < 4) { toast('Le code doit avoir au moins 4 chiffres', true); return; }
    Object.assign(S, {
      name: $('#s-name', v).value.trim() || 'Smart Pressing', city: $('#s-city', v).value.trim(), phone: $('#s-phone', v).value.trim(),
      cousinRate: Number($('#s-rate', v).value) || 0, deliveryFee: Number($('#s-deliv', v).value) || 0,
      savingsPercent: Number($('#s-sav', v).value) || 0, invoiceStart: Number($('#s-start', v).value) || 1, adminPin: pin,
    });
    if (pin) unlocked = true;
    await L.saveSettings(S); toast('Réglages enregistrés');
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

routes.backup = async () => {
  setNav('more');
  setTop({ title: 'Sauvegarde', back: '#/more' });
  const last = await db.kv('lastBackup');
  const [no, ne, np] = [await db.count('orders'), await db.count('expenses'), await db.count('photos')];
  const v = view(`<div class="card stack">
      <p style="margin:0">Toutes les données sont <b>uniquement dans ce téléphone</b>. S'il est perdu, cassé ou si l'appli est désinstallée, elles disparaissent.
      Faites une sauvegarde chaque semaine et envoyez-la ailleurs (WhatsApp à vous-même, Google Drive, e-mail).</p>
      <p class="small muted" style="margin:0">Contenu : ${no} facture(s), ${ne} dépense(s), ${np} photo(s).<br>Dernière sauvegarde : <b>${last ? fmtDate(last) : 'jamais'}</b></p>
      <button class="btn primary big block" id="b-share">Créer et envoyer la sauvegarde</button>
      <button class="btn block" id="b-save">Enregistrer dans le téléphone</button>
    </div>
    <div class="card stack"><b>Restaurer</b>
      <p class="small muted" style="margin:0">Pour un nouveau téléphone : installez l'appli, puis choisissez le fichier de sauvegarde (.json).</p>
      <label class="btn ghost block">Choisir un fichier de sauvegarde<input type="file" accept="application/json,.json" id="b-file" hidden></label></div>`);
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
};

// ---------------------------------------------------------------- routeur
async function render() {
  if (cleanup) { try { cleanup(); } catch (e) {} cleanup = null; }
  const raw = location.hash.replace(/^#\/?/, '') || 'home';
  const [path, qs] = raw.split('?');
  const [name, arg, arg2] = path.split('/');
  const q = new URLSearchParams(qs || '');
  if (!(await L.isInitialized()) && name !== 'welcome') { location.hash = '#/welcome'; return; }
  const fn = routes[name] || routes.home;
  try { await fn(arg, q, arg2); }
  catch (e) { console.error(e); view(`<div class="flash err">Erreur : ${esc(e.message)}</div>`); }
}

async function boot() {
  S = await L.getSettings();
  await render();
}

window.addEventListener('hashchange', async () => { S = await L.getSettings(); render(); });
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
