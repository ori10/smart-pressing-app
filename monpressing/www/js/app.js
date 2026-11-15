import { db as store } from './db.js';
import { isNative, shareFile, shareText, waOpen, hasNativeSpeech, listenNative } from './native.js';
import * as cloud from './cloud.js';
import { executer as iaExecuter } from './ia.js';
/* =========================================================
   MonPressing — gestion de pressing pour le Bénin
   Données : dans le téléphone (IndexedDB) + sauvegarde chiffrée dans Supabase, bucket « saves »
   ========================================================= */

// ---------- Utilitaires ----------
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const F = n => new Intl.NumberFormat('fr-FR').format(Math.round(n || 0)) + ' F';
const ymd = d => { d = new Date(d); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
const today = () => ymd(new Date());
const dFR = d => d ? new Date(typeof d === 'string' && d.length === 10 ? d + 'T12:00' : d).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' }) : '';
const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
const jours = t => Math.max(0, Math.floor((Date.now() - t) / 864e5));
const JOURS = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];
const MOIS = ['janv', 'févr', 'mars', 'avr', 'mai', 'juin', 'juil', 'août', 'sept', 'oct', 'nov', 'déc'];
const STATUTS = { recu: 'Reçu', en_cours: 'En traitement', pret: 'Prêt', retire: 'Retiré' };
const MODES = { especes: 'Espèces', mtn: 'MTN MoMo', moov: 'Moov Money', celtiis: 'Celtiis Cash', autre: 'Autre' };
// Petites valeurs (utilisateur, réglages…) : copie en mémoire, enregistrée dans IndexedDB
const KV = {};
function safeGet(k, def) { return KV[k] === undefined || KV[k] === null ? def : KV[k]; }
function safeSet(k, v) { KV[k] = v; store.kv(k, v).catch(e => console.warn('Enregistrement impossible', e)); }
function setPath(o, p, v) { const k = p.split('.'); let x = o; while (k.length > 1) { const a = k.shift(); x = x[a] = x[a] || {}; } x[k[0]] = v; }
function toast(t) { $$('.toast').forEach(x => x.remove()); const el = document.createElement('div'); el.className = 'toast'; el.textContent = t; document.body.appendChild(el); setTimeout(() => el.remove(), 3200); }
function telIntl(t) { let d = String(t || '').replace(/\D/g, ''); if (!d) return ''; if (d.startsWith('00')) d = d.slice(2); if (d.startsWith('229') && d.length >= 11) return d; if (d.length === 10 && d.startsWith('01')) return '229' + d; if (d.length === 8) return '22901' + d; return d; }
const wa = (tel, txt) => 'https://wa.me/' + telIntl(tel) + '?text=' + encodeURIComponent(txt || '');

const ICONS = {
  home: '<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>',
  plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
  list: '<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>',
  users: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  menu: '<line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>',
  camera: '<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>',
  mic: '<path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/>',
  msg: '<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>',
  truck: '<rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/>',
  tag: '<path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/>',
  card: '<rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/>',
  spark: '<path d="M12 3l1.9 5.8L20 10l-6.1 1.2L12 17l-1.9-5.8L4 10l6.1-1.2z"/>',
  drop: '<path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"/>',
  sliders: '<line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/>',
  print: '<polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>',
  x: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
  cloud: '<path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/>',
  vol: '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>',
  alert: '<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>'
};
const ic = n => `<svg class="ico" viewBox="0 0 24 24">${ICONS[n] || ''}</svg>`;

// ---------- Données ----------
const LS_DB = 'data', LS_CFG = 'cfg', LS_USER = 'user';
const COLLS = ['clients', 'factures', 'promotions', 'journal', 'clotures'];

function defaultSettings() {
  const cat = [['Chemise', 500, 2, false, 0], ['Pantalon', 500, 2, false, 0], ['Tee-shirt / Polo', 300, 2, false, 0], ['Jean', 600, 2, false, 0], ['Robe', 1000, 2, false, 0], ['Costume 2 pièces', 2500, 3, true, 1500], ['Veste', 1500, 3, true, 900], ['Boubou bazin', 2000, 3, true, 1200], ['Grand boubou', 2500, 3, true, 1500], ['Ensemble pagne', 1000, 2, false, 0], ['Robe de soirée', 3000, 3, true, 1800], ['Tenue de mariage', 5000, 4, true, 3000], ['Drap', 700, 2, false, 0], ['Couverture', 2000, 3, false, 0], ['Rideau', 1500, 3, false, 0], ['Cravate', 300, 2, false, 0]];
  return {
    id: 'settings', updatedAt: 0, nom: 'MonPressing', tel: '', adresse: '',
    momo: { mtn: '', moov: '', celtiis: '' }, cousin: { nom: 'Le cousin', tel: '' },
    expressMajoration: 50, capaciteJour: 40, moisPluies: [4, 5, 6, 7, 9, 10, 11],
    catalogue: cat.map(([nom, prix, delai, cousin, coutCousin]) => ({ nom, prix, delai, cousin, coutCousin })),
    users: [{ id: 'u_admin', nom: 'Patron', role: 'admin', pin: '0000' }]
  };
}
function loadDB(raw) {
  const d = raw || {};
  const e = { settings: { ...defaultSettings(), ...(d.settings || {}) } };
  COLLS.forEach(c => e[c] = Array.isArray(d[c]) ? d[c] : []);
  return e;
}
let db = loadDB();
// Toutes les données sont gardées dans le téléphone (IndexedDB), enregistrées peu après chaque modification.
let persistT = null;
const persist = () => { clearTimeout(persistT); persistT = setTimeout(flush, 250); };
function flush() { clearTimeout(persistT); return store.kv(LS_DB, db).catch(e => toast('Enregistrement impossible : ' + e.message)); }
const all = c => db[c].filter(r => !r.deleted);
const get = (c, id) => db[c].find(r => r.id === id && !r.deleted);
function put(c, rec) {
  if (!rec.id) rec.id = uid();
  rec.updatedAt = Date.now();
  const i = db[c].findIndex(r => r.id === rec.id);
  if (i >= 0) db[c][i] = rec; else db[c].push(rec);
  persist(); return rec;
}
function saveSettings() { db.settings.updatedAt = Date.now(); persist(); }
function merge(a, b) {
  const sa = a.settings || {}, sbb = b.settings || {};
  const out = { settings: { ...defaultSettings(), ...((sa.updatedAt || 0) >= (sbb.updatedAt || 0) ? sa : sbb) } };
  COLLS.forEach(c => {
    const m = new Map();
    [...(b[c] || []), ...(a[c] || [])].forEach(r => { const x = m.get(r.id); if (!x || (r.updatedAt || 0) > (x.updatedAt || 0)) m.set(r.id, r); });
    out[c] = [...m.values()];
  });
  return out;
}
const signature = d => COLLS.map(c => d[c].length + ':' + d[c].reduce((m, r) => Math.max(m, r.updatedAt || 0), 0)).join('|') + '|' + (d.settings.updatedAt || 0);
const cfg = () => ({ ia: true, iaKey: '', ...safeGet(LS_CFG, {}) });
const setCfg = p => safeSet(LS_CFG, { ...cfg(), ...p });

// ---------- Photos (IndexedDB, magasin « photos ») ----------
const photoCache = {};
async function photoSave(id, dataUrl) { photoCache[id] = dataUrl; await store.put('photos', dataUrl, id); }
async function getPhoto(id) { if (photoCache[id]) return photoCache[id]; const v = await store.get('photos', id).catch(() => null); if (v) photoCache[id] = v; return v; }
function loadPhotos() { $$('img[data-photo]').forEach(async img => { const s = await getPhoto(img.dataset.photo); if (s) img.src = s; else img.style.display = 'none'; }); }
function compressImage(file, max = 1024, q = 0.72) {
  return new Promise((res, rej) => {
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => {
      let w = img.width, h = img.height; const s = Math.min(1, max / Math.max(w, h)); w = Math.round(w * s); h = Math.round(h * s);
      const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d'); x.drawImage(img, 0, 0, w, h);
      // Horodatage incrusté = preuve de l'état au dépôt
      x.fillStyle = 'rgba(0,0,0,.55)'; x.fillRect(0, h - 26, w, 26); x.fillStyle = '#fff'; x.font = '15px sans-serif';
      x.fillText(db.settings.nom + ' · ' + new Date().toLocaleString('fr-FR'), 8, h - 8);
      URL.revokeObjectURL(url); res(c.toDataURL('image/jpeg', q));
    };
    img.onerror = rej; img.src = url;
  });
}

// ---------- Sauvegarde en ligne (Supabase, bucket « saves ») ----------
const getCloud = () => ({ enabled: false, url: '', key: '', password: '', ...safeGet('cloud', {}) });
async function exportAll() {
  await flush();
  const photos = {};
  for (const k of await store.keys('photos')) photos[k] = await store.get('photos', k);
  return { app: 'monpressing', version: 1, exportedAt: new Date().toISOString(), data: db, photos };
}
async function importAll(d) {
  if (!d || d.app !== 'monpressing' || !d.data) throw new Error('Ce fichier n’est pas une sauvegarde MonPressing.');
  db = loadDB(d.data); await flush();
  await store.clear('photos');
  for (const [k, v] of Object.entries(d.photos || {})) await store.put('photos', v, k);
  Object.keys(photoCache).forEach(k => delete photoCache[k]);
}
let backingUp = false;
async function backupNow() {
  const size = await cloud.uploadBackup(getCloud(), await exportAll(), today());
  const r = { at: new Date().toISOString(), ok: true, size };
  safeSet('cloudLast', r); safeSet('cloudLastOk', r.at); safeSet('lastExport', r.at);
  return r;
}
// Automatique : chaque soir à partir de 19 h (ou dès l'ouverture si la dernière a plus de 36 h).
async function autoBackup() {
  const c = getCloud();
  if (backingUp || !navigator.onLine || !c.enabled || !c.url || !c.key || !c.password) return;
  const last = safeGet('cloudLast', {}), lastOk = safeGet('cloudLastOk', '');
  const depuis = lastOk ? (Date.now() - new Date(lastOk).getTime()) / 3600e3 : 1e9, faitAujourdhui = lastOk && ymd(lastOk) === today();
  if (!((new Date().getHours() >= 19 && !faitAujourdhui) || depuis > 36)) return;
  if (last.ok === false && last.at && Date.now() - new Date(last.at).getTime() < 30 * 60e3) return; // pas d'acharnement
  backingUp = true;
  try { await backupNow(); } catch (e) { safeSet('cloudLast', { at: new Date().toISOString(), ok: false, error: e.message }); }
  finally { backingUp = false; renderSyncBadge(); }
}
function syncBadge() {
  if (!getCloud().enabled) return '';
  const l = safeGet('cloudLast', null);
  if (!l) return `<span class="pill mut">${ic('cloud')} Pas encore sauvegardé</span>`;
  return l.ok ? `<span class="pill ok">${ic('cloud')} Sauvegardé ${dFR(l.at)}</span>` : `<a class="pill bad" href="#/parametres" title="${esc(l.error || '')}">Sauvegarde en échec</a>`;
}
function renderSyncBadge() { const el = $('#syncb'); if (el) el.innerHTML = syncBadge(); }
const aiReady = () => navigator.onLine && cfg().ia !== false && !!cfg().iaKey;
async function ai(task, payload) {
  if (!aiReady()) throw new Error('IA indisponible (connexion ou clé API manquante)');
  const c = cfg(); return iaExecuter(task, payload, { key: c.iaKey, texte: c.modeleTexte, vision: c.modeleVision });
}

// ---------- Voix ----------
function ecouter(onText, onEnd) {
  if (hasNativeSpeech) { toast('Parlez maintenant…'); listenNative().then(t => { if (t) onText(t); }).catch(e => toast('Micro : ' + (e.message || e))).finally(() => onEnd && onEnd()); return null; }
  const R = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!R) { toast('Dictée vocale non disponible : utilisez Chrome sur Android, ou tapez le texte.'); return null; }
  const r = new R(); r.lang = 'fr-FR'; r.interimResults = false; r.continuous = false;
  r.onresult = e => onText([...e.results].map(x => x[0].transcript).join(' '));
  r.onerror = e => toast('Micro : ' + e.error); r.onend = () => onEnd && onEnd();
  try { r.start(); toast('Parlez maintenant…'); } catch { }
  return r;
}
function parler(t) { try { const u = new SpeechSynthesisUtterance(t); u.lang = 'fr-FR'; speechSynthesis.cancel(); speechSynthesis.speak(u); } catch { toast('Lecture vocale indisponible'); } }

// ---------- Logique métier ----------
const currentUser = () => { const id = safeGet(LS_USER, null); return db.settings.users.find(u => u.id === id) || null; };
const isAdmin = () => currentUser()?.role === 'admin';
const userName = id => db.settings.users.find(u => u.id === id)?.nom || '—';
const clientNom = id => get('clients', id)?.nom || 'Client inconnu';
const catItem = n => db.settings.catalogue.find(c => c.nom === n) || db.settings.catalogue.find(c => norm(c.nom) === norm(n));
const paye = f => (f.paiements || []).reduce((s, p) => s + (+p.montant || 0), 0);
const reste = f => f.annulee ? 0 : Math.max(0, (f.total || 0) - paye(f));
const factClient = cid => all('factures').filter(f => f.clientId === cid);
const soldeClient = cid => factClient(cid).reduce((s, f) => s + reste(f), 0);
const totalImpayes = () => all('factures').reduce((s, f) => s + reste(f), 0);
const dernierPassage = cid => { const fs = factClient(cid).filter(f => f.type !== 'arriere'); return fs.length ? Math.max(...fs.map(f => f.createdAt)) : null; };
function logJ(type, f, montant, info) { put('journal', { type, factureId: f?.id, numero: f?.numero, montant, info: info || '', user: currentUser()?.id, createdAt: Date.now() }); }
const numeroFacture = () => 'MP' + today().slice(2).replace(/-/g, '') + '-' + Math.random().toString(36).slice(2, 6).toUpperCase();

function promoBase(p, lignes) { const arts = p.articles || []; return lignes.filter(l => !arts.length || arts.includes(l.article)).reduce((s, l) => s + (+l.prix || 0) * (+l.qte || 0), 0); }
function promoRemise(p, lignes) { const b = promoBase(p, lignes); if (!b || b < (+p.minimum || 0)) return 0; return p.type === 'pourcent' ? Math.round(b * p.valeur / 100) : Math.min(b, +p.valeur || 0); }
function promoEnCours(p) { const d = today(); return p.actif && (!p.debut || d >= p.debut) && (!p.fin || d <= p.fin); }
function promoActive(p, clientId, date = new Date()) {
  if (!promoEnCours(p)) return false;
  if (p.jours?.length && !p.jours.includes(date.getDay())) return false;
  if (p.cible === 'nouveaux' && clientId && factClient(clientId).some(f => f.type !== 'arriere')) return false;
  if (p.cible === 'inactifs') { if (!clientId) return false; const l = dernierPassage(clientId); if (!l || Date.now() - l < 60 * 864e5) return false; }
  return true;
}
const promoLib = p => p.type === 'pourcent' ? `−${p.valeur} %` : `−${F(p.valeur)}`;
function promoConditions(p) {
  const c = [];
  if (p.jours?.length) c.push('le ' + p.jours.map(j => JOURS[j].toLowerCase()).join(', '));
  if (p.debut || p.fin) c.push((p.debut ? 'du ' + dFR(p.debut) : '') + (p.fin ? ' au ' + dFR(p.fin) : ''));
  if (p.articles?.length) c.push('sur ' + p.articles.join(', '));
  if (p.cible === 'nouveaux') c.push('nouveaux clients'); if (p.cible === 'inactifs') c.push('clients inactifs depuis 2 mois');
  if (+p.minimum) c.push('dès ' + F(p.minimum));
  return c.join(' · ') || 'Tous les jours, tous les articles';
}
function usagePromo(id) { const fs = all('factures').filter(f => f.promoId === id && !f.annulee); return { n: fs.length, remise: fs.reduce((s, f) => s + (f.remisePromo || 0), 0) }; }

function calcFacture(d) {
  const S = db.settings; let st = 0;
  d.lignes.forEach(l => st += (+l.prix || 0) * (+l.qte || 0));
  const maj = d.express ? Math.round(st * S.expressMajoration / 100) : 0;
  const p = d.promoId && get('promotions', d.promoId);
  const rp = p ? promoRemise(p, d.lignes) : 0;
  const rm = +d.remiseManuelle || 0, arr = +d.arriere?.montant || 0;
  return { sousTotal: st, maj, remisePromo: rp, remiseManuelle: rm, arriere: arr, total: Math.max(0, st + maj - rp - rm) + arr };
}
function choosePromo(d) {
  if (!d.promoAuto) return;
  let best = null, bv = 0;
  all('promotions').filter(p => promoActive(p, d.clientId)).forEach(p => { const v = promoRemise(p, d.lignes); if (v > bv) { bv = v; best = p; } });
  d.promoId = best?.id || null;
}
function chargeEnCours() { return all('factures').filter(f => !f.annulee && ['recu', 'en_cours'].includes(f.statut)).reduce((s, f) => s + f.lignes.filter(l => !l.cousin).reduce((a, l) => a + (+l.qte || 0), 0), 0); }
function suggestionCousin(article) {
  const c = catItem(article), ch = chargeEnCours();
  if (c?.cousin) return { oui: true, raison: 'habituellement confié au cousin' };
  if (ch > db.settings.capaciteJour * 1.5) return { oui: true, raison: `atelier chargé : ${ch} pièces en cours` };
  return { oui: false };
}
function dateRetraitSuggeree(d) {
  const S = db.settings, raisons = [];
  let j = d.express ? 1 : Math.max(1, ...d.lignes.map(l => catItem(l.article)?.delai || 2));
  if (!d.express) {
    if (d.lignes.some(l => l.cousin)) { j += 1; raisons.push('+1 j cousin'); }
    if (S.moisPluies.includes(new Date().getMonth() + 1)) { j += 1; raisons.push('+1 j saison des pluies'); }
    const ch = chargeEnCours();
    if (ch > S.capaciteJour) { const x = Math.min(3, Math.floor(ch / S.capaciteJour)); j += x; raisons.push(`+${x} j atelier chargé`); }
  }
  const dt = new Date(); let n = 0;
  while (n < j) { dt.setDate(dt.getDate() + 1); if (dt.getDay() !== 0) n++; }
  return { date: ymd(dt), raisons };
}
function risqueClient(cid) {
  const fs = factClient(cid).filter(f => !f.annulee), imp = fs.filter(f => reste(f) > 0);
  const solde = imp.reduce((s, f) => s + reste(f), 0);
  if (!solde) return { score: 0, label: 'À jour', cls: 'ok', solde: 0, jours: 0, nb: 0 };
  const j = jours(Math.min(...imp.map(f => f.createdAt)));
  const retires = imp.filter(f => f.statut === 'retire' && f.type !== 'arriere').length;
  const payes = fs.filter(f => reste(f) === 0).length;
  let score = Math.min(40, j) + imp.length * 8 + retires * 15 - Math.min(20, payes * 2) + (solde > 20000 ? 15 : solde > 5000 ? 8 : 0);
  score = Math.max(0, Math.min(100, score));
  return { score, label: score >= 60 ? 'Risque élevé' : score >= 30 ? 'À surveiller' : 'Bon payeur en retard', cls: score >= 60 ? 'bad' : score >= 30 ? 'warn' : 'ok', jours: j, solde, nb: imp.length };
}
function debiteurs() { return all('clients').map(c => ({ c, r: risqueClient(c.id) })).filter(x => x.r.solde > 0).sort((a, b) => b.r.score - a.r.score || b.r.solde - a.r.solde); }
function infosPaiement() {
  const m = db.settings.momo, p = [];
  if (m.mtn) p.push('MTN MoMo ' + m.mtn); if (m.moov) p.push('Moov Money ' + m.moov); if (m.celtiis) p.push('Celtiis Cash ' + m.celtiis);
  return p.length ? `Vous pouvez payer par ${p.join(', ')} (au nom de ${db.settings.nom}).` : '';
}
function momentRelance() {
  const d = new Date().getDate();
  return (d >= 25 || d <= 5) ? { bon: true, txt: 'Bon moment pour relancer : c\'est la période de paie (fin et début de mois).' } : { bon: false, txt: `Conseil : les relances marchent mieux entre le 25 et le 5 du mois (dans ${25 - d} jours).` };
}
function messageRelance(c, r, ton) {
  const S = db.settings, p = infosPaiement();
  if (ton === 'ferme') return `Bonjour ${c.nom}, ${S.nom} vous rappelle qu'un solde de ${F(r.solde)} reste impayé depuis ${r.jours} jours. Merci de le régler au plus vite. ${p}`.trim();
  return `Bonjour ${c.nom}, ici ${S.nom}. Petit rappel amical : il reste ${F(r.solde)} à régler sur vos commandes. ${p} Merci pour votre fidélité et bonne journée !`.replace(/\s+/g, ' ').trim();
}
const resumeLignes = f => { const s = f.lignes.map(l => l.qte + ' ' + l.article).join(', '); return s.length > 70 ? s.slice(0, 67) + '…' : s; };
function msgPret(f, c) { const r = reste(f); return `Bonjour ${c.nom}, vos habits (facture ${f.numero}) sont prêts chez ${db.settings.nom} ! ${r > 0 ? `Reste à payer : ${F(r)}. ${infosPaiement()}` : 'Tout est déjà payé, merci.'} Votre code de retrait : ${f.code}. À bientôt !`.replace(/\s+/g, ' '); }
function msgRecu(f, c) {
  const L = f.lignes.map(l => `- ${l.qte} × ${l.article} : ${F(l.montant)}`).join('\n');
  return `${db.settings.nom} — Reçu ${f.numero}\nClient : ${c?.nom || ''}\n${L}${f.arriere ? `\n- Arriéré (${f.arriere.motif || 'ancien solde'}) : ${F(f.arriere.montant)}` : ''}\nTotal : ${F(f.total)}\nPayé : ${F(paye(f))}\nReste : ${F(reste(f))}\n${f.dateRetrait ? 'Retrait prévu : ' + dFR(f.dateRetrait) + '\n' : ''}Code de retrait : ${f.code}\nMerci de votre confiance !`;
}
function lignesCousin() { const o = []; all('factures').forEach(f => { if (f.annulee) return; f.lignes.forEach(l => { if (l.cousin) o.push({ f, l }); }); }); return o; }
const sumQ = a => a.reduce((s, x) => s + (+x.l.qte || 0), 0);
const piecesChezCousin = () => sumQ(lignesCousin().filter(x => x.l.cousinStatut === 'chez_cousin'));
function statsCousin() {
  const L = lignesCousin(), rev = L.filter(x => x.l.backAt && x.l.sentAt), dm = debutPeriode('mois');
  return {
    delai: rev.length ? Math.round(rev.reduce((s, x) => s + (x.l.backAt - x.l.sentAt) / 864e5, 0) / rev.length * 10) / 10 : null,
    coutMois: L.filter(x => (x.l.sentAt || 0) >= dm).reduce((s, x) => s + (catItem(x.l.article)?.coutCousin || 0) * x.l.qte, 0)
  };
}
function debutPeriode(per) { const d = new Date(); d.setHours(0, 0, 0, 0); if (per === 'semaine') d.setDate(d.getDate() - (d.getDay() + 6) % 7); if (per === 'mois') d.setDate(1); if (per === 'annee') d.setMonth(0, 1); return d.getTime(); }
const LIBPER = { jour: "aujourd'hui", semaine: 'cette semaine', mois: 'ce mois', annee: 'cette année' };
function encaisse(per, fin = Infinity, debut = null) {
  const s = debut ?? debutPeriode(per); let enc = 0, nbP = 0, fact = 0, nbF = 0;
  all('factures').forEach(f => {
    if (f.annulee) return;
    (f.paiements || []).forEach(p => { if (p.date >= s && p.date < fin) { enc += +p.montant; nbP++; } });
    if (f.type !== 'arriere' && f.createdAt >= s && f.createdAt < fin) { fact += f.total; nbF++; }
  });
  return { enc, nbPaiements: nbP, fact, nbFact: nbF };
}
function cashAttendu(day) {
  let esp = 0, momo = 0;
  all('factures').forEach(f => { if (f.annulee) return; (f.paiements || []).forEach(p => { if (ymd(p.date) !== day) return; if (p.mode === 'especes') esp += +p.montant; else if (['mtn', 'moov', 'celtiis'].includes(p.mode)) momo += +p.montant; }); });
  return { esp, momo };
}
function anomalies() {
  const res = [], since = Date.now() - 30 * 864e5, by = {};
  const U = id => by[id] = by[id] || { n: 0, ann: 0, rem: 0 };
  all('factures').filter(f => f.createdAt > since && f.type !== 'arriere').forEach(f => { U(f.createdBy).n++; if ((+f.remiseManuelle || 0) > 0) U(f.createdBy).rem++; if (f.annulee) U(f.annuleBy || f.createdBy).ann++; });
  Object.entries(by).forEach(([u, s]) => {
    const n = Math.max(1, s.n);
    if (s.ann >= 3 && s.ann / n > 0.1) res.push({ niveau: 'haut', txt: `${userName(u)} a annulé ${s.ann} factures ces 30 derniers jours (${Math.round(s.ann / n * 100)} % de ses factures).` });
    if (s.rem >= 3 && s.rem / n > 0.2) res.push({ niveau: 'moyen', txt: `${userName(u)} a accordé une remise manuelle sur ${s.rem} factures sur ${s.n}.` });
  });
  all('clotures').filter(c => c.createdAt > since).forEach(c => {
    const e = (c.especesDeclarees || 0) - (c.especesAttendues || 0);
    if (Math.abs(e) >= 500) res.push({ niveau: e < 0 ? 'haut' : 'moyen', txt: `Caisse du ${dFR(c.date)} (${userName(c.user)}) : écart espèces de ${F(e)} (compté ${F(c.especesDeclarees)}, attendu ${F(c.especesAttendues)}).` });
    if (c.momoDeclare !== null && c.momoDeclare !== undefined) { const m = c.momoDeclare - (c.momoAttendu || 0); if (Math.abs(m) >= 500) res.push({ niveau: 'moyen', txt: `Mobile Money du ${dFR(c.date)} : écart de ${F(m)} (reçu ${F(c.momoDeclare)}, enregistré ${F(c.momoAttendu)}).` }); }
  });
  const rnp = all('journal').filter(j => j.type === 'retrait_impaye' && j.createdAt > since);
  if (rnp.length >= 3) res.push({ niveau: 'moyen', txt: `${rnp.length} commandes ont été remises au client sans paiement complet ces 30 derniers jours.` });
  return res;
}
// Calendrier béninois pour les promotions
function paques(y) { const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451), mo = Math.floor((h + l - 7 * m + 114) / 31), da = ((h + l - 7 * m + 114) % 31) + 1; return new Date(y, mo - 1, da); }
const FETES_MUSULMANES = { 2026: [['Tabaski', 4, 27]], 2027: [['Ramadan (Korité)', 2, 10], ['Tabaski', 4, 17]], 2028: [['Ramadan (Korité)', 1, 27], ['Tabaski', 4, 5]] };
function evenements(y) {
  const T = ['Boubou bazin', 'Grand boubou', 'Ensemble pagne'];
  const ev = [
    { nom: 'Fête du Vodoun', date: new Date(y, 0, 10), avant: 10, promo: 'Spécial 10 janvier', pourquoi: 'beaucoup de tenues traditionnelles à préparer.', articles: T },
    { nom: 'Pâques', date: paques(y), avant: 10, promo: 'Tenues de Pâques', pourquoi: 'les familles préparent leurs tenues pour l\'église.' },
    { nom: 'Fête de l\'Indépendance', date: new Date(y, 7, 1), avant: 10, promo: 'Spécial 1er août', pourquoi: 'défilés, cérémonies et sorties.' },
    { nom: 'Rentrée scolaire', date: new Date(y, 8, 14), avant: 14, promo: 'Uniformes de rentrée', pourquoi: 'les parents font laver uniformes et tenues.', approx: true, articles: ['Chemise', 'Pantalon', 'Robe'] },
    { nom: 'Fêtes de fin d\'année', date: new Date(y, 11, 24), avant: 21, promo: 'Fêtes de fin d\'année', pourquoi: 'pic de mariages, sorties et tenues de fête.' }
  ];
  (FETES_MUSULMANES[y] || []).forEach(([n, m, d]) => ev.push({ nom: n, date: new Date(y, m, d), avant: 10, promo: 'Spécial ' + n, pourquoi: 'beaucoup de boubous et tenues à préparer.', approx: true, articles: T }));
  return ev;
}
function evenementsProches(n) { const y = new Date().getFullYear(), now = Date.now(); return [...evenements(y), ...evenements(y + 1)].filter(e => e.date.getTime() >= now - 864e5 && e.date.getTime() <= now + n * 864e5).sort((a, b) => a.date - b.date); }
function suggestionsPromos() {
  const sug = [], fs = all('factures').filter(f => !f.annulee && f.type !== 'arriere' && f.createdAt > Date.now() - 56 * 864e5);
  if (fs.length >= 10) {
    const by = [0, 0, 0, 0, 0, 0, 0]; fs.forEach(f => by[new Date(f.createdAt).getDay()] += f.total);
    const open = [1, 2, 3, 4, 5, 6], min = open.reduce((a, b) => by[b] < by[a] ? b : a), avg = open.reduce((s, d) => s + by[d], 0) / 6;
    if (avg && by[min] < avg * 0.7) sug.push({ nom: JOURS[min] + ' malin', type: 'pourcent', valeur: 15, jours: [min], cible: 'tous', raison: `Le ${JOURS[min].toLowerCase()} est votre jour le plus calme (${Math.round(by[min] / avg * 100)} % de la moyenne).` });
  }
  const inact = all('clients').filter(c => { const l = dernierPassage(c.id); return l && Date.now() - l > 60 * 864e5; });
  if (inact.length >= 3) sug.push({ nom: 'On vous a manqué', type: 'pourcent', valeur: 20, cible: 'inactifs', fin: ymd(Date.now() + 30 * 864e5), raison: `${inact.length} clients ne sont pas revenus depuis plus de 2 mois.` });
  evenementsProches(45).forEach(e => sug.push({ nom: e.promo, type: 'pourcent', valeur: 10, debut: ymd(Math.max(Date.now(), e.date.getTime() - e.avant * 864e5)), fin: ymd(e.date), cible: 'tous', articles: e.articles || [], raison: `${e.nom} le ${dFR(e.date)}${e.approx ? ' (date approximative)' : ''} : ${e.pourquoi}` }));
  const m = new Date().getMonth() + 1;
  if (m === 11 || m === 12) sug.push({ nom: 'Forfait cérémonie', type: 'pourcent', valeur: 10, cible: 'tous', articles: ['Tenue de mariage', 'Robe de soirée', 'Grand boubou', 'Boubou bazin'], minimum: 5000, fin: ymd(new Date(new Date().getFullYear(), 11, 31)), raison: 'Saison des mariages et cérémonies : fidélisez les familles qui apportent plusieurs tenues.' });
  if (!all('factures').length) sug.push({ nom: 'Bienvenue', type: 'pourcent', valeur: 10, cible: 'nouveaux', raison: 'Attirer de nouveaux clients avec −10 % sur leur premier dépôt.' });
  return sug;
}
function topArticles(days) { const m = {}; all('factures').filter(f => !f.annulee && f.createdAt > Date.now() - days * 864e5).forEach(f => f.lignes.forEach(l => m[l.article] = (m[l.article] || 0) + (+l.qte || 0))); return Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([article, pieces]) => ({ article, pieces })); }
function topClients(days) { const m = {}; all('factures').filter(f => !f.annulee && f.type !== 'arriere' && f.createdAt > Date.now() - days * 864e5).forEach(f => m[f.clientId] = (m[f.clientId] || 0) + f.total); return Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([id, total]) => ({ nom: clientNom(id), total })); }
function resumeDonnees() {
  const fs = all('factures').filter(f => !f.annulee), cs = statsCousin(), L = lignesCousin(), mois = [];
  for (let i = 5; i >= 0; i--) { const d = new Date(); d.setDate(1); d.setHours(0, 0, 0, 0); d.setMonth(d.getMonth() - i); const f = new Date(d); f.setMonth(f.getMonth() + 1); const e = encaisse(null, f.getTime(), d.getTime()); mois.push({ mois: MOIS[d.getMonth()] + ' ' + d.getFullYear(), facture: e.fact, encaisse: e.enc }); }
  return {
    pressing: db.settings.nom, date: today(),
    encaisse: { jour: encaisse('jour'), semaine: encaisse('semaine'), mois: encaisse('mois'), annee: encaisse('annee') },
    par_mois: mois, impayes_total: totalImpayes(),
    debiteurs: debiteurs().slice(0, 10).map(d => ({ nom: d.c.nom, doit: d.r.solde, jours: d.r.jours, profil: d.r.label })),
    commandes: { recues: fs.filter(f => f.statut === 'recu' && f.type !== 'arriere').length, en_traitement: fs.filter(f => f.statut === 'en_cours').length, pretes_non_retirees: fs.filter(f => f.statut === 'pret').length },
    cousin: { a_envoyer: sumQ(L.filter(x => x.l.cousinStatut === 'a_envoyer')), chez_cousin: piecesChezCousin(), delai_moyen_jours: cs.delai, cout_ce_mois: cs.coutMois },
    meilleurs_clients_90j: topClients(90), articles_90j: topArticles(90), nb_clients: all('clients').length,
    promotions_actives: all('promotions').filter(promoEnCours).map(p => p.nom + ' ' + promoLib(p)), alertes: anomalies().map(a => a.txt)
  };
}
function resumeHebdo() {
  const s = debutPeriode('semaine'), cur = encaisse(null, Infinity, s), prev = encaisse(null, s, s - 7 * 864e5);
  const evo = prev.enc ? Math.round((cur.enc - prev.enc) / prev.enc * 100) : null, deb = debiteurs().slice(0, 3), an = anomalies();
  return `Résumé de la semaine (depuis lundi) — ${db.settings.nom}\n• Encaissé : ${F(cur.enc)}${evo !== null ? ` (${evo >= 0 ? '+' : ''}${evo} % par rapport à toute la semaine dernière)` : ''}\n• Nouvelles factures : ${cur.nbFact} pour ${F(cur.fact)}\n• Impayés au total : ${F(totalImpayes())}${deb.length ? '\n• Ceux qui doivent le plus : ' + deb.map(d => `${d.c.nom} (${F(d.r.solde)})`).join(', ') : ''}\n• Pièces chez le cousin : ${piecesChezCousin()}\n• Alertes de caisse : ${an.length || 'aucune'}`;
}
function repondreLocal(q) {
  const t = norm(q), per = /aujourd|ce jour/.test(t) ? 'jour' : /semaine/.test(t) ? 'semaine' : /annee|cette an/.test(t) ? 'annee' : 'mois';
  if (/resume|bilan/.test(t)) return resumeHebdo();
  if (/gagne|chiffre|recette|encaiss|vendu|revenu|argent/.test(t)) { const r = encaisse(per); return `Encaissé ${LIBPER[per]} : ${F(r.enc)} (${r.nbPaiements} paiements).\nFacturé ${LIBPER[per]} : ${F(r.fact)} sur ${r.nbFact} factures.`; }
  if (/doit|dette|impaye|arriere|credit/.test(t)) { const d = debiteurs(); return d.length ? `Impayés au total : ${F(totalImpayes())}.\n` + d.slice(0, 5).map((x, i) => `${i + 1}. ${x.c.nom} : ${F(x.r.solde)} (${x.r.label}, ${x.r.jours} j)`).join('\n') : 'Personne ne vous doit d\'argent. Bravo !'; }
  if (/cousin|sous.?trait/.test(t)) { const L = lignesCousin(), s = statsCousin(); return `Chez le cousin : ${piecesChezCousin()} pièce(s). À envoyer : ${sumQ(L.filter(x => x.l.cousinStatut === 'a_envoyer'))}.\nDélai moyen : ${s.delai ?? '—'} jours. Coût ce mois : ${F(s.coutMois)}.`; }
  if (/pret|retir|attente/.test(t)) { const p = all('factures').filter(f => !f.annulee && f.statut === 'pret'); return p.length ? `${p.length} commande(s) prête(s) à retirer :\n` + p.slice(0, 10).map(f => `• ${clientNom(f.clientId)} — ${f.numero} (reste ${F(reste(f))})`).join('\n') : 'Aucune commande prête en attente.'; }
  if (/client/.test(t) && /meilleur|fidele|top|plus gros/.test(t)) { const c = topClients(90); return c.length ? 'Meilleurs clients (90 jours) :\n' + c.map((x, i) => `${i + 1}. ${x.nom} : ${F(x.total)}`).join('\n') : 'Pas encore assez de données.'; }
  return null;
}
const NOMBRES = { un: 1, une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, six: 6, sept: 7, huit: 8, neuf: 9, dix: 10, onze: 11, douze: 12, quinze: 15, vingt: 20 };
function parseDictee(txt) {
  const t = norm(txt), res = { lignes: [], express: /express|urgent/.test(t), client: null };
  const cat = [...db.settings.catalogue].sort((a, b) => b.nom.length - a.nom.length);
  t.split(/,|;|\bet\b|\bpuis\b|\bplus\b/).forEach(seg => {
    seg = seg.trim(); if (!seg) return;
    const sing = seg.replace(/s\b/g, '');
    let it = cat.find(c => seg.includes(norm(c.nom)) || sing.includes(norm(c.nom).replace(/s\b/g, '')));
    if (!it) it = cat.find(c => { const w = norm(c.nom).split(/[\s/]+/)[0]; return w.length > 3 && new RegExp('\\b' + w + 's?\\b').test(seg); });
    if (!it) return;
    const rest = seg.replace(norm(it.nom), ' ');
    let q = 1; const m = rest.match(/\b(\d+)\b/);
    if (m) q = +m[1]; else for (const [w, v] of Object.entries(NOMBRES)) if (new RegExp('\\b' + w + '\\b').test(rest)) { q = v; break; }
    res.lignes.push({ article: it.nom, qte: q });
  });
  const cl = all('clients').find(c => norm(c.nom).length > 2 && t.includes(norm(c.nom))) || all('clients').find(c => norm(c.nom).split(/\s+/).some(p => p.length > 3 && new RegExp('\\b' + p + '\\b').test(t)));
  if (cl) res.client = cl.nom; else { const mc = t.match(/pour (?:madame|monsieur|mme|mr|mademoiselle|mlle|maman|papa|tonton|tata)?\s*([a-z\- ]{2,40}?)(?:,|\.|$| avec| express)/); if (mc) res.client = mc[1].trim().replace(/\b\w/g, x => x.toUpperCase()); }
  return res;
}

// ---------- Modales ----------
function modal(html) { $('#modal').innerHTML = `<div class="modal" data-act="modalBg"><div>${html}</div></div>`; }
function closeModal() { $('#modal').innerHTML = ''; }
function confirmBox(msg, oui = 'Oui', non = 'Non') { return new Promise(res => { modal(`<p style="font-size:16px">${esc(msg)}</p><div class="row" style="margin-top:12px"><button class="btn p" id="cbY">${oui}</button><button class="btn" id="cbN">${non}</button></div>`); $('#cbY').onclick = () => { closeModal(); res(true); }; $('#cbN').onclick = () => { closeModal(); res(false); }; }); }
function promptBox(msg, type = 'text') { return new Promise(res => { modal(`<form id="pbF"><label style="font-size:15px;color:var(--ink)">${esc(msg)}</label><input id="pbI" type="${type}" autocomplete="off"><div class="row" style="margin-top:12px"><button class="btn p">Valider</button><button type="button" class="btn" id="pbN">Annuler</button></div></form>`); const i = $('#pbI'); i.focus(); $('#pbF').onsubmit = e => { e.preventDefault(); e.stopPropagation(); const v = i.value.trim(); closeModal(); res(v || null); }; $('#pbN').onclick = () => { closeModal(); res(null); }; }); }
function waModal(titre, txt, tel, rel) { return `<h2>${esc(titre)}</h2><textarea id="mtxt" rows="8">${esc(txt)}</textarea><div class="row" style="margin-top:10px"><a class="btn p" href="#" target="_blank" rel="noopener" data-act="sendWa" data-wa="${esc(tel || '')}" ${rel ? `data-rel="${rel}"` : ''}>${ic('msg')}Envoyer sur WhatsApp</a><button class="btn" data-act="copyTxt">Copier</button><button class="btn" data-act="closeModal">Fermer</button></div>${tel ? '' : '<p class="mut" style="font-size:13px">Pas de numéro : WhatsApp vous laissera choisir le contact.</p>'}`; }

// ---------- Écran & navigation ----------
const state = { view: 'accueil', param: null, draft: null, cq: '', q: '', clq: '', filtre: 'actives', chat: [], sugs: [], sugsIA: [], detPhoto: null };
const go = (v, p) => { location.hash = '#/' + v + (p ? '/' + p : ''); };
function route() { const [v, p] = location.hash.replace(/^#\/?/, '').split('/'); state.view = v || 'accueil'; state.param = p || null; closeModal(); render(); window.scrollTo(0, 0); }
const NAV = [['accueil', 'Accueil', 'home'], ['nouvelle', 'Nouvelle facture', 'plus'], ['commandes', 'Commandes', 'list'], ['clients', 'Clients', 'users'], ['recouvrement', 'Recouvrement', 'card'], ['cousin', 'Cousin', 'truck'], ['promos', 'Promotions', 'tag', true], ['assistant', 'Assistant du patron', 'spark', true], ['detachage', 'Détachage', 'drop'], ['parametres', 'Paramètres', 'sliders']];
function shell(c) {
  const u = currentUser(), v = state.view, main4 = ['accueil', 'nouvelle', 'commandes', 'clients'];
  return `<div class="shell"><nav class="side"><div class="brand">${ic('drop')} MonPressing</div>${NAV.filter(n => !n[3] || isAdmin()).map(n => `<a href="#/${n[0]}" class="${v === n[0] || (v === 'facture' && n[0] === 'commandes') || (v === 'client' && n[0] === 'clients') ? 'on' : ''}">${ic(n[2])}${n[1]}</a>`).join('')}<div style="margin-top:18px;padding:0 10px;font-size:13px;color:#cfe5de">${esc(u.nom)} · ${u.role === 'admin' ? 'Admin' : 'Employé'}<br><a href="#" data-act="logout" style="padding:6px 0;color:#fff">Changer d'utilisateur</a></div></nav><main>${c}</main><nav class="bnav">${[['accueil', 'Accueil', 'home'], ['nouvelle', 'Facture', 'plus'], ['commandes', 'Commandes', 'list'], ['clients', 'Clients', 'users'], ['plus', 'Plus', 'menu']].map(n => `<a href="#/${n[0]}" class="${v === n[0] || (n[0] === 'plus' && !main4.includes(v) && v !== 'facture' && v !== 'client') || (v === 'facture' && n[0] === 'commandes') || (v === 'client' && n[0] === 'clients') ? 'on' : ''}">${ic(n[2])}${n[1]}</a>`).join('')}</nav></div>`;
}
const topbar = (t, actions = '') => `<div class="top"><h1>${t}</h1><div class="row">${actions}<span id="syncb">${syncBadge()}</span></div></div>`;
const kpi = (l, v, href) => `<a class="card kpi" ${href ? `href="${href}"` : ''}><div class="l">${l}</div><div class="v">${v}</div></a>`;
function statutPill(f) { if (f.annulee) return '<span class="pill mut">Annulée</span>'; if (f.type === 'arriere') return '<span class="pill warn">Arriéré</span>'; return `<span class="pill ${{ recu: 'mut', en_cours: '', pret: 'ok', retire: 'mut' }[f.statut]}">${STATUTS[f.statut]}</span>`; }
function rowFacture(f) { const r = reste(f); return `<a class="lrow" href="#/facture/${f.id}"><div style="min-width:0"><b>${esc(clientNom(f.clientId))}</b> <span class="mut">· ${esc(f.numero)}</span><div class="mut" style="font-size:13px">${f.type === 'arriere' ? 'Arriéré : ' + esc(f.arriere?.motif || 'ancien solde') : esc(resumeLignes(f))} · ${dFR(f.createdAt)}</div></div><div class="r" style="flex:none">${F(f.total)}<div>${statutPill(f)}${r > 0 ? ` <span class="pill warn">reste ${F(r)}</span>` : ''}</div></div></a>`; }
const modesOpts = sel => Object.entries(MODES).map(([k, l]) => `<option value="${k}" ${k === sel ? 'selected' : ''}>${l}</option>`).join('');
const catOpts = sel => db.settings.catalogue.map(c => `<option ${c.nom === sel ? 'selected' : ''}>${esc(c.nom)}</option>`).join('') + (sel && !db.settings.catalogue.some(c => c.nom === sel) ? `<option selected>${esc(sel)}</option>` : '');

// ----- Connexion locale -----
function vLogin() {
  const us = db.settings.users, def = us.some(u => u.role === 'admin' && u.pin === '0000');
  return `<div style="max-width:380px;margin:9vh auto;padding:16px"><div class="brand" style="color:var(--pri);font-size:28px;justify-content:center">${ic('drop')} MonPressing</div><div class="card"><form data-form="login"><label>Qui êtes-vous ?</label><select name="u">${us.map(u => `<option value="${u.id}">${esc(u.nom)} (${u.role === 'admin' ? 'Admin' : 'Employé'})</option>`).join('')}</select><label>Code PIN</label><input name="pin" type="password" inputmode="numeric" autocomplete="off" required><div style="margin-top:12px"><button class="btn p" style="width:100%;justify-content:center">Entrer</button></div>${def ? '<p class="mut" style="font-size:13px">Première utilisation : choisissez « Patron », PIN 0000, puis changez-le dans Paramètres.</p>' : ''}</form></div>${!all('factures').length ? `<div class="card"><h2>Nouveau téléphone ?</h2><p class="mut" style="margin-top:0">Reprenez les données d'un autre téléphone.</p><div class="row"><label class="btn" style="margin:0;color:var(--ink);font-size:15px">Restaurer une sauvegarde<input type="file" accept="application/json,.json" data-act-change="import" hidden></label><button class="btn" data-act="cloudRestore">Restaurer depuis internet</button></div></div>` : ''}</div>`;
}

// ----- Accueil -----
function vAccueil() {
  const u = currentUser(), adm = isAdmin(), fs = all('factures').filter(f => !f.annulee);
  const prets = fs.filter(f => f.statut === 'pret' && f.type !== 'arriere'), an = adm ? anomalies() : [], deb = debiteurs().slice(0, 3), m = momentRelance();
  const retards = fs.filter(f => ['recu', 'en_cours'].includes(f.statut) && f.dateRetrait && f.dateRetrait < today());
  const aEnv = sumQ(lignesCousin().filter(x => x.l.cousinStatut === 'a_envoyer')), sug = adm ? suggestionsPromos() : [], it = [];
  if (adm && db.settings.users.some(x => x.role === 'admin' && x.pin === '0000')) it.push(`<p>${ic('alert')} Changez le code PIN par défaut du patron dans <a href="#/parametres">Paramètres</a>.</p>`);
  if (retards.length) it.push(`<p><b>${retards.length} commande(s) en retard</b> sur la date promise : ${retards.slice(0, 4).map(f => `<a href="#/facture/${f.id}">${esc(clientNom(f.clientId))}</a>`).join(', ')}. Prévenez les clients avant qu'ils se déplacent.</p>`);
  if (aEnv) it.push(`<p>${aEnv} pièce(s) attendent d'être envoyées au cousin. <a href="#/cousin">Préparer l'envoi</a></p>`);
  if (deb.length) it.push(`<p>${esc(m.txt)} À relancer en priorité : ${deb.map(d => `<a href="#/client/${d.c.id}">${esc(d.c.nom)}</a> (${F(d.r.solde)})`).join(', ')}. <a href="#/recouvrement">Relancer</a></p>`);
  if (adm && !getCloud().enabled && (!safeGet('lastExport', '') || Date.now() - new Date(safeGet('lastExport', '')).getTime() > 7 * 864e5)) it.push(`<p>${ic('cloud')} Le téléphone est la seule copie de vos données : activez la <a href="#/parametres">sauvegarde en ligne</a> ou créez une sauvegarde chaque semaine.</p>`);
  if (sug[0]) it.push(`<p>Idée de promotion : <b>${esc(sug[0].nom)}</b> (${promoLib(sug[0])}) — ${esc(sug[0].raison)} <a href="#/promos">Voir</a></p>`);
  if (adm && !all('factures').length) it.push(`<p>Nouvelle installation ? <button class="btn sm" data-act="demo">Charger des données de démonstration</button></p>`);
  const ca = cashAttendu(today());
  return topbar('Bonjour ' + esc(u.nom), `<a class="btn p" href="#/nouvelle">${ic('plus')}Nouvelle facture</a>`) +
    `<div class="grid">${kpi("Encaissé aujourd'hui", F(encaisse('jour').enc))}${kpi('Encaissé ce mois', F(encaisse('mois').enc))}${kpi('Impayés totaux', F(totalImpayes()), '#/recouvrement')}${kpi('Prêts à retirer', prets.length, '#/commandes')}${kpi('Pièces chez le cousin', piecesChezCousin(), '#/cousin')}</div>
    ${an.length ? `<div class="card" style="border-left:4px solid var(--bad)"><h2>${ic('alert')} Alertes de caisse</h2>${an.map(a => `<p style="margin:6px 0">• ${esc(a.txt)}</p>`).join('')}</div>` : ''}
    ${it.length ? `<div class="card ia"><h2>${ic('spark')} À faire aujourd'hui</h2>${it.join('')}</div>` : ''}
    <div class="card"><div class="row" style="justify-content:space-between"><h2 style="margin:0">Caisse du jour</h2><button class="btn sm" data-act="cloture">Clôturer la caisse</button></div>${adm ? `<p class="mut" style="margin-bottom:0">Enregistré aujourd'hui : espèces ${F(ca.esp)} · Mobile Money ${F(ca.momo)}</p>` : '<p class="mut" style="margin-bottom:0">En fin de journée, comptez la caisse et clôturez.</p>'}</div>
    <div class="card"><h2>Prêts à retirer</h2>${prets.slice(0, 8).map(rowFacture).join('') || '<p class="mut">Rien pour le moment.</p>'}</div>`;
}

// ----- Nouvelle facture -----
function newDraft(clientId = null) { return { id: uid(), clientId, clientNom: '', clientTel: '', lignes: [], express: false, promoId: null, promoAuto: true, remiseManuelle: 0, remiseMotif: '', arriere: { montant: 0, motif: '' }, envoiCousin: false, dateRetrait: null, dateManuelle: false, acompte: 0, modeAcompte: 'especes' }; }
function clientCard(c) { const r = risqueClient(c.id); return `<div class="row" style="justify-content:space-between"><div><b>${esc(c.nom)}</b> <span class="mut">${esc(c.tel || '')}</span><div style="margin-top:4px">${r.solde ? `<span class="pill ${r.cls}">${r.label} · doit ${F(r.solde)}</span>` : '<span class="pill ok">À jour</span>'}</div></div><button class="btn sm" data-act="clearClient">Changer</button></div>`; }
function ligneHTML(l, i, d) {
  return `<div class="line-item"><div class="row" style="align-items:flex-start;flex-wrap:nowrap">${l.photoId ? `<img class="thumb" data-photo="${l.photoId}" data-act="zoomPhoto" alt="">` : ''}<div style="flex:1;min-width:0"><div class="row" style="flex-wrap:nowrap"><select data-l="${i}" data-k="article" style="flex:2">${catOpts(l.article)}</select><input data-l="${i}" data-k="qte" type="number" min="1" inputmode="numeric" value="${l.qte}" style="width:62px;flex:none" title="Quantité"><input data-l="${i}" data-k="prix" type="number" min="0" inputmode="numeric" value="${l.prix}" style="width:86px;flex:none" title="Prix unitaire"><button class="btn sm d" data-act="delLigne" data-i="${i}" title="Retirer">${ic('x')}</button></div><input data-l="${i}" data-k="notes" placeholder="Taches, dégâts, remarques…" value="${esc(l.notes || '')}" style="margin-top:6px">${l.ia ? `<div class="mut" style="font-size:12px;margin-top:4px">${ic('spark')} IA : ${esc(l.ia)}</div>` : ''}${d.envoiCousin ? `<label class="switch" style="margin-top:8px"><input type="checkbox" data-lchk="${i}" ${l.cousin ? 'checked' : ''}> Envoyer chez le cousin</label>` : ''}</div></div></div>`;
}
function totauxHTML(d) {
  const c = calcFacture(d);
  return `<table class="tot"><tr><td>Sous-total</td><td class="r">${F(c.sousTotal)}</td></tr>${c.maj ? `<tr><td>Express</td><td class="r">+${F(c.maj)}</td></tr>` : ''}${c.remisePromo ? `<tr><td>Promotion</td><td class="r">−${F(c.remisePromo)}</td></tr>` : ''}${c.remiseManuelle ? `<tr><td>Remise</td><td class="r">−${F(c.remiseManuelle)}</td></tr>` : ''}${c.arriere ? `<tr><td>Arriéré ajouté</td><td class="r">+${F(c.arriere)}</td></tr>` : ''}<tr><td><b>Total</b></td><td class="r big">${F(c.total)}</td></tr><tr><td class="mut">Reste après acompte</td><td class="r mut">${F(Math.max(0, c.total - (+d.acompte || 0)))}</td></tr></table>`;
}
function refreshTotaux() { const d = state.draft; if (!d) return; choosePromo(d); const el = $('#totaux'); if (el) el.innerHTML = totauxHTML(d); }
function renderCRes() {
  const el = $('#cres'); if (!el) return; const q = norm(state.cq); if (!q) { el.innerHTML = ''; return; }
  const qd = q.replace(/\D/g, '');
  const r = all('clients').filter(c => norm(c.nom).includes(q) || (qd && String(c.tel || '').replace(/\D/g, '').includes(qd))).slice(0, 6);
  el.innerHTML = r.map(c => `<button class="btn sm" style="margin:6px 6px 0 0" data-act="pickClient" data-id="${c.id}">${esc(c.nom)}${c.tel ? ' · ' + esc(c.tel) : ''}</button>`).join('') || '<p class="mut" style="margin:6px 0 0">Aucun client trouvé : remplissez « nouveau client » ci-dessous.</p>';
}
function vNouvelle() {
  const d = state.draft || (state.draft = newDraft()), S = db.settings, cl = d.clientId && get('clients', d.clientId);
  choosePromo(d);
  const promos = all('promotions').filter(p => promoActive(p, d.clientId) || p.id === d.promoId);
  const sugC = d.lignes.map(l => ({ l, s: suggestionCousin(l.article) })).filter(x => x.s.oui && !x.l.cousin);
  const dr = dateRetraitSuggeree(d); if (!d.dateManuelle) d.dateRetrait = dr.date;
  const sold = cl ? soldeClient(cl.id) : 0, risk = cl ? risqueClient(cl.id) : null;
  return topbar('Nouvelle facture', `<button class="btn sm" data-act="draftReset">Tout effacer</button>`) + `
  <div class="card"><h2>1. Client</h2>${cl ? clientCard(cl) : `<input id="cq" placeholder="Rechercher un client (nom ou téléphone)…" value="${esc(state.cq)}" autocomplete="off"><div id="cres"></div><div class="f2" style="margin-top:6px"><div><label>Ou nouveau client : nom</label><input data-d="clientNom" value="${esc(d.clientNom)}" placeholder="Ex. Mme Houngbo"></div><div><label>Téléphone WhatsApp</label><input data-d="clientTel" inputmode="tel" value="${esc(d.clientTel)}" placeholder="01 97 00 00 00"></div></div>`}</div>
  <div class="card"><div class="row" style="justify-content:space-between"><h2 style="margin:0">2. Articles</h2><div class="row"><button class="btn sm" data-act="dictee">${ic('mic')}Dicter</button><label class="btn sm" style="margin:0;color:var(--ink);font-size:13px">${ic('camera')}Photo<input type="file" accept="image/*" capture="environment" data-act-change="photoLigne" hidden></label><button class="btn sm p" data-act="addLigne">${ic('plus')}Article</button></div></div>
   <div id="dicteeZone"></div>
   <div style="margin-top:10px">${d.lignes.map((l, i) => ligneHTML(l, i, d)).join('') || '<p class="mut">Ajoutez les articles à la main, en photo (l\'IA reconnaît le vêtement et note les taches) ou en dictant.</p>'}</div>
   <label class="switch" style="margin-top:6px"><input type="checkbox" data-dchk="express" ${d.express ? 'checked' : ''}> Express (+${S.expressMajoration} %)</label></div>
  <div class="card"><h2>3. Envoi chez le cousin</h2><div class="seg" style="max-width:360px"><button data-act="cousinMode" data-v="0" class="${!d.envoiCousin ? 'on' : ''}">Non, tout reste ici</button><button data-act="cousinMode" data-v="1" class="${d.envoiCousin ? 'on' : ''}">Oui, je choisis</button></div>
   ${d.envoiCousin ? '<p class="mut" style="margin:8px 0 0">Cochez « Envoyer chez le cousin » sur chaque article concerné.</p>' : ''}
   ${sugC.length ? `<div class="card ia" style="margin:10px 0 0"><b>Suggestion :</b> envoyer ${sugC.map(x => esc(x.l.article) + ' (' + esc(x.s.raison) + ')').join(', ')}. <button class="btn sm" data-act="applySugCousin">Appliquer</button><div class="mut" style="font-size:12px;margin-top:4px">C'est vous qui décidez.</div></div>` : ''}</div>
  <div class="card"><h2>4. Arriérés (antécédents du client)</h2>${sold ? `<p style="margin-top:0">Ce client doit déjà <b>${F(sold)}</b> sur ses anciennes factures dans l'application.</p>` : ''}<p class="mut" style="margin-top:0">Ajoutez ici une ancienne dette (cahier, avant l'application…). Elle s'ajoute au total de cette facture.</p><div class="f2"><div><label>Montant de l'arriéré</label><input type="number" min="0" inputmode="numeric" data-d="arriere.montant" value="${d.arriere.montant || ''}" placeholder="0"></div><div><label>Motif</label><input data-d="arriere.motif" placeholder="Ex. reste de décembre (cahier)" value="${esc(d.arriere.motif)}"></div></div></div>
  <div class="card"><h2>5. Promotion, remise et retrait</h2>
   <label>Promotion</label><select data-dsel="promoId"><option value="">Aucune</option>${promos.map(p => `<option value="${p.id}" ${p.id === d.promoId ? 'selected' : ''}>${esc(p.nom)} (${promoLib(p)}) → −${F(promoRemise(p, d.lignes))}</option>`).join('')}</select>${d.promoAuto && d.promoId ? '<div class="mut" style="font-size:12px">Meilleure promotion appliquée automatiquement.</div>' : ''}
   <div class="f2"><div><label>Remise manuelle (F)</label><input type="number" min="0" inputmode="numeric" data-d="remiseManuelle" value="${d.remiseManuelle || ''}"></div><div><label>Motif de la remise</label><input data-d="remiseMotif" value="${esc(d.remiseMotif)}" placeholder="Obligatoire si remise"></div></div>
   <label>Date de retrait</label><input type="date" data-d="dateRetrait" value="${d.dateRetrait}"><div class="mut" style="font-size:12px;margin-top:4px">Date conseillée : ${dFR(dr.date)}${dr.raisons.length ? ' (' + dr.raisons.join(', ') + ')' : ''}${d.dateManuelle ? ` · <a href="#" data-act="dateAuto">reprendre la date conseillée</a>` : ''}</div></div>
  <div class="card"><h2>6. Paiement</h2><div id="totaux">${totauxHTML(d)}</div><div class="f2"><div><label>Acompte versé</label><input type="number" min="0" inputmode="numeric" data-d="acompte" value="${d.acompte || ''}"></div><div><label>Mode</label><select data-dsel="modeAcompte">${modesOpts(d.modeAcompte)}</select></div></div>
   ${risk && risk.score >= 60 ? '<p class="pill bad" style="margin-top:10px;white-space:normal">Client à risque élevé : demandez le paiement avant de remettre les habits.</p>' : ''}
   <button class="btn p" data-act="saveFacture" style="width:100%;justify-content:center;padding:13px;margin-top:14px">Enregistrer la facture</button></div>`;
}

// ----- Commandes -----
function listeCommandes() {
  const q = norm(state.q), k = state.filtre; let fs = all('factures').sort((a, b) => b.createdAt - a.createdAt);
  if (k === 'actives') fs = fs.filter(f => !f.annulee && f.type !== 'arriere' && ['recu', 'en_cours', 'pret'].includes(f.statut));
  if (k === 'pret') fs = fs.filter(f => !f.annulee && f.type !== 'arriere' && f.statut === 'pret');
  if (k === 'impayees') fs = fs.filter(f => reste(f) > 0);
  if (q) fs = fs.filter(f => norm(clientNom(f.clientId) + ' ' + f.numero + ' ' + (f.code || '')).includes(q));
  return fs.slice(0, 200).map(rowFacture).join('') || '<p class="mut">Aucune commande.</p>';
}
function vCommandes() { return topbar('Commandes', `<a class="btn p sm" href="#/nouvelle">${ic('plus')}Nouvelle</a>`) + `<div class="card"><div class="seg" style="margin-bottom:10px">${[['actives', 'En cours'], ['pret', 'Prêtes'], ['impayees', 'Impayées'], ['toutes', 'Toutes']].map(([k, l]) => `<button data-act="filtre" data-v="${k}" class="${state.filtre === k ? 'on' : ''}">${l}</button>`).join('')}</div><input id="qsearch" placeholder="Rechercher : client, numéro, code de retrait…" value="${esc(state.q)}"><div id="liste">${listeCommandes()}</div></div>`; }

// ----- Détail facture -----
function vFacture(id) {
  const f = get('factures', id); if (!f) return topbar('Facture introuvable');
  const c = get('clients', f.clientId), r = reste(f), adm = isAdmin(), p = f.promoId && get('promotions', f.promoId);
  const CS = { a_envoyer: 'À envoyer au cousin', chez_cousin: 'Chez le cousin', revenu: 'Revenu du cousin' };
  return topbar('Facture ' + esc(f.numero)) + `
  <div class="card"><div class="row" style="justify-content:space-between;align-items:flex-start"><div><a href="#/client/${f.clientId}" style="font-weight:700;font-size:17px">${esc(c?.nom || '?')}</a> <span class="mut">${esc(c?.tel || '')}</span><div class="mut" style="font-size:13px">Créée le ${new Date(f.createdAt).toLocaleString('fr-FR')} par ${esc(userName(f.createdBy))}${f.type !== 'arriere' && f.dateRetrait ? ` · Retrait prévu ${dFR(f.dateRetrait)}` : ''}</div></div><div class="r">${statutPill(f)}${f.code ? `<div class="mut" style="font-size:12px;margin-top:4px">Code de retrait : <b style="color:var(--ink)">${f.code}</b></div>` : ''}</div></div>
   ${!f.annulee && f.type !== 'arriere' ? `<div class="seg" style="margin-top:12px">${['recu', 'en_cours', 'pret', 'retire'].map(s => `<button class="${f.statut === s ? 'on' : ''}" data-act="statut" data-id="${f.id}" data-s="${s}">${STATUTS[s]}</button>`).join('')}</div>` : ''}
   ${f.annulee ? `<p class="pill bad" style="white-space:normal;margin-top:10px">Annulée par ${esc(userName(f.annuleBy))} : ${esc(f.annuleMotif || '')}</p>` : ''}</div>
  ${f.lignes.length ? `<div class="card"><h2>Articles</h2>${f.lignes.map(l => `<div class="lrow"><div class="row" style="flex-wrap:nowrap;min-width:0;align-items:flex-start">${l.photoId ? `<img class="thumb" data-photo="${l.photoId}" data-act="zoomPhoto" alt="">` : ''}<div style="min-width:0"><b>${l.qte} × ${esc(l.article)}</b> <span class="mut">${F(l.prix)}</span>${l.notes ? `<div class="mut" style="font-size:13px">${esc(l.notes)}</div>` : ''}${l.cousin ? `<div><span class="pill">${CS[l.cousinStatut] || 'Cousin'}</span></div>` : (!f.annulee && ['recu', 'en_cours'].includes(f.statut) ? `<button class="btn sm" style="margin-top:4px" data-act="toCousin" data-f="${f.id}" data-l="${l.id}">${ic('truck')}Envoyer au cousin</button>` : '')}</div></div><div class="r" style="flex:none">${F(l.montant)}</div></div>`).join('')}</div>` : ''}
  <div class="card"><h2>Montant</h2><table class="tot">${f.type !== 'arriere' ? `<tr><td>Sous-total</td><td class="r">${F(f.sousTotal)}</td></tr>` : ''}${f.majoration ? `<tr><td>Express</td><td class="r">+${F(f.majoration)}</td></tr>` : ''}${f.remisePromo ? `<tr><td>Promotion${p ? ' « ' + esc(p.nom) + ' »' : ''}</td><td class="r">−${F(f.remisePromo)}</td></tr>` : ''}${f.remiseManuelle ? `<tr><td>Remise (${esc(f.remiseMotif || '')})</td><td class="r">−${F(f.remiseManuelle)}</td></tr>` : ''}${f.arriere ? `<tr><td>Arriéré : ${esc(f.arriere.motif || 'ancien solde')}</td><td class="r">+${F(f.arriere.montant)}</td></tr>` : ''}<tr><td><b>Total</b></td><td class="r"><b>${F(f.total)}</b></td></tr><tr><td>Payé</td><td class="r">${F(paye(f))}</td></tr><tr><td><b>Reste à payer</b></td><td class="r big" style="color:${r ? 'var(--bad)' : 'var(--ok)'}">${F(r)}</td></tr></table>
   ${(f.paiements || []).length ? `<h2 style="margin-top:14px">Paiements</h2>${f.paiements.map(x => `<div class="lrow"><span class="mut" style="font-size:14px">${new Date(x.date).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })} · ${MODES[x.mode] || x.mode} · ${esc(userName(x.user))}</span><span class="row" style="flex:none">${F(x.montant)}${adm ? `<button class="btn sm d" data-act="delPaiement" data-f="${f.id}" data-p="${x.id}" title="Supprimer">${ic('x')}</button>` : ''}</span></div>`).join('')}` : ''}
   ${r > 0 ? `<form data-form="paiement" class="row" style="margin-top:12px;align-items:flex-end"><input type="hidden" name="id" value="${f.id}"><div style="flex:1;min-width:120px"><label>Montant reçu</label><input name="montant" type="number" min="1" inputmode="numeric" value="${r}" required></div><div style="flex:1;min-width:140px"><label>Mode</label><select name="mode">${modesOpts('especes')}</select></div><button class="btn p">Encaisser</button></form>` : ''}</div>
  <div class="card row"><button class="btn" data-act="recuWa" data-id="${f.id}">${ic('msg')}Reçu WhatsApp</button><button class="btn" data-act="imprimer" data-id="${f.id}">${ic('print')}Imprimer</button>${r > 0 ? `<button class="btn a" data-act="lienPaiement" data-id="${f.id}">Demander le paiement</button>` : ''}${!f.annulee ? `<button class="btn d" data-act="annuler" data-id="${f.id}">Annuler la facture</button>` : ''}</div>`;
}

// ----- Clients -----
function listeClients() {
  const q = norm(state.clq), qd = q.replace(/\D/g, '');
  return all('clients').filter(c => !q || norm(c.nom).includes(q) || (qd && String(c.tel || '').replace(/\D/g, '').includes(qd))).sort((a, b) => a.nom.localeCompare(b.nom, 'fr')).slice(0, 300).map(c => { const r = risqueClient(c.id); return `<a class="lrow" href="#/client/${c.id}"><div><b>${esc(c.nom)}</b><div class="mut" style="font-size:13px">${esc(c.tel || '')}${c.quartier ? ' · ' + esc(c.quartier) : ''}</div></div><div class="r">${r.solde ? `<span class="pill ${r.cls}">doit ${F(r.solde)}</span>` : '<span class="pill ok">À jour</span>'}</div></a>`; }).join('') || '<p class="mut">Aucun client.</p>';
}
function vClients() { return topbar('Clients', `<button class="btn p sm" data-act="newClient">${ic('plus')}Nouveau client</button>`) + `<div class="card"><input id="clq" placeholder="Rechercher un client…" value="${esc(state.clq)}"><div id="cliste">${listeClients()}</div></div>`; }
function clientForm(c = {}) { return `<h2>${c.id ? 'Modifier le client' : 'Nouveau client'}</h2><form data-form="client"><input type="hidden" name="id" value="${c.id || ''}"><label>Nom</label><input name="nom" required value="${esc(c.nom || '')}"><label>Téléphone WhatsApp</label><input name="tel" inputmode="tel" value="${esc(c.tel || '')}"><label>Quartier</label><input name="quartier" value="${esc(c.quartier || '')}"><label>Notes</label><textarea name="notes" rows="2">${esc(c.notes || '')}</textarea><div class="row" style="margin-top:12px"><button class="btn p">Enregistrer</button><button type="button" class="btn" data-act="closeModal">Annuler</button></div></form>`; }
function vClient(id) {
  const c = get('clients', id); if (!c) return topbar('Client introuvable');
  const fs = factClient(id).sort((a, b) => b.createdAt - a.createdAt), r = risqueClient(id), tot = fs.filter(f => !f.annulee && f.type !== 'arriere').reduce((s, f) => s + f.total, 0);
  return topbar(esc(c.nom), `<button class="btn sm" data-act="editClient" data-id="${id}">Modifier</button>`) + `
  <div class="grid">${kpi('Doit actuellement', F(r.solde))}${kpi('Profil', `<span class="pill ${r.cls}" style="font-size:14px">${r.label}</span>`)}${kpi('Total des dépôts', F(tot))}${kpi('Dernier passage', dernierPassage(id) ? dFR(dernierPassage(id)) : '—')}</div>
  <div class="card"><p style="margin-top:0">${c.tel ? `<a href="tel:${esc(c.tel)}">${esc(c.tel)}</a> · <a href="${wa(c.tel, 'Bonjour ' + c.nom + ', ')}" target="_blank" rel="noopener">WhatsApp</a>` : '<span class="mut">Pas de téléphone</span>'}${c.quartier ? ' · ' + esc(c.quartier) : ''}</p>${c.notes ? `<p class="mut">${esc(c.notes)}</p>` : ''}${r.score >= 60 ? '<p class="pill bad" style="white-space:normal">Conseil : ne plus accorder de crédit à ce client tant que le solde n\'est pas réglé.</p>' : ''}
   <div class="row"><button class="btn p" data-act="newFactClient" data-id="${id}">${ic('plus')}Nouvelle facture</button><button class="btn" data-act="arriereClient" data-id="${id}">Ajouter un arriéré</button>${r.solde ? `<button class="btn a" data-act="relance" data-id="${id}">${ic('msg')}Relancer</button>` : ''}</div></div>
  <div class="card"><h2>Historique</h2>${fs.map(rowFacture).join('') || '<p class="mut">Aucune facture.</p>'}</div>`;
}

// ----- Recouvrement -----
function vRecouvrement() {
  const m = momentRelance(), deb = debiteurs();
  return topbar('Recouvrement des impayés') + `<div class="card ${m.bon ? 'ia' : ''}">${esc(m.txt)}</div>
  <div class="grid">${kpi('Total à recouvrer', F(deb.reduce((s, d) => s + d.r.solde, 0)))}${kpi('Clients concernés', deb.length)}${kpi('Risque élevé', deb.filter(d => d.r.score >= 60).length)}</div>
  <div class="card">${deb.map(d => `<div class="lrow"><a href="#/client/${d.c.id}" style="color:inherit;text-decoration:none;min-width:0"><b>${esc(d.c.nom)}</b><div class="mut" style="font-size:13px">${d.r.nb} facture(s) · la plus ancienne date de ${d.r.jours} j${d.c.derniereRelance ? ` · relancé il y a ${jours(d.c.derniereRelance)} j` : ''}</div><span class="pill ${d.r.cls}">${d.r.label}</span>${d.r.score >= 60 ? ' <span class="mut" style="font-size:12px">plus de crédit conseillé</span>' : ''}</a><div class="r" style="flex:none"><div style="font-weight:800">${F(d.r.solde)}</div><button class="btn sm p" style="margin-top:4px" data-act="relance" data-id="${d.c.id}">${ic('msg')}Relancer</button></div></div>`).join('') || '<p class="mut">Aucun impayé. Bravo !</p>'}</div>`;
}

// ----- Cousin -----
function rowLigneC(x) {
  const s = x.l.cousinStatut;
  return `<div class="lrow"><div style="min-width:0"><b>${x.l.qte} × ${esc(x.l.article)}</b> <span class="mut">· <a href="#/facture/${x.f.id}">${esc(x.f.numero)}</a> · ${esc(clientNom(x.f.clientId))}${s === 'chez_cousin' ? ' · depuis ' + jours(x.l.sentAt) + ' j' : ''}</span>${x.l.notes ? `<div class="mut" style="font-size:12px">${esc(x.l.notes)}</div>` : ''}</div>${s === 'chez_cousin' ? `<button class="btn sm p" data-act="cousinRevenu" data-f="${x.f.id}" data-l="${x.l.id}">Revenu</button>` : `<button class="btn sm" data-act="cousinGarder" data-f="${x.f.id}" data-l="${x.l.id}">Garder ici</button>`}</div>`;
}
function vCousin() {
  const L = lignesCousin(), aEnv = L.filter(x => x.l.cousinStatut === 'a_envoyer'), chez = L.filter(x => x.l.cousinStatut === 'chez_cousin').sort((a, b) => a.l.sentAt - b.l.sentAt), st = statsCousin();
  return topbar('Chez ' + esc(db.settings.cousin.nom || 'le cousin')) + `<div class="grid">${kpi('À envoyer', sumQ(aEnv))}${kpi('Chez le cousin', sumQ(chez))}${kpi('Délai moyen', st.delai !== null ? st.delai + ' j' : '—')}${kpi('Coût cousin ce mois', F(st.coutMois))}</div>
  <div class="card"><div class="row" style="justify-content:space-between"><h2 style="margin:0">À envoyer</h2>${aEnv.length ? `<button class="btn sm p" data-act="envoyerCousin">${ic('truck')}Tout envoyer + bordereau WhatsApp</button>` : ''}</div>${aEnv.map(rowLigneC).join('') || '<p class="mut">Rien à envoyer.</p>'}</div>
  <div class="card"><h2>Chez le cousin</h2>${chez.map(rowLigneC).join('') || '<p class="mut">Aucune pièce chez le cousin.</p>'}</div>`;
}

// ----- Promotions -----
function promoForm(p = {}) {
  const S = db.settings;
  return `<h2>${p.id ? 'Modifier la' : 'Nouvelle'} promotion</h2><form data-form="promo"><input type="hidden" name="id" value="${p.id || ''}"><label>Nom</label><input name="nom" required value="${esc(p.nom || '')}"><div class="f2"><div><label>Type</label><select name="type"><option value="pourcent" ${p.type !== 'montant' ? 'selected' : ''}>Pourcentage (%)</option><option value="montant" ${p.type === 'montant' ? 'selected' : ''}>Montant fixe (F)</option></select></div><div><label>Valeur</label><input name="valeur" type="number" min="1" required value="${p.valeur || ''}"></div></div><div class="f2"><div><label>Début (facultatif)</label><input name="debut" type="date" value="${p.debut || ''}"></div><div><label>Fin (facultatif)</label><input name="fin" type="date" value="${p.fin || ''}"></div></div><label>Jours (aucun coché = tous les jours)</label><div class="row">${JOURS.map((j, i) => `<label class="switch" style="font-weight:500"><input type="checkbox" name="j${i}" ${(p.jours || []).includes(i) ? 'checked' : ''}>${j.slice(0, 3)}</label>`).join('')}</div><label>Articles concernés (aucun coché = tous)</label><div class="row">${S.catalogue.map((c, i) => `<label class="switch" style="font-weight:500"><input type="checkbox" name="a${i}" ${(p.articles || []).includes(c.nom) ? 'checked' : ''}>${esc(c.nom)}</label>`).join('')}</div><div class="f2"><div><label>Pour qui</label><select name="cible">${[['tous', 'Tous les clients'], ['nouveaux', 'Nouveaux clients'], ['inactifs', 'Clients inactifs (2 mois et plus)']].map(([v, l]) => `<option value="${v}" ${p.cible === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div><div><label>Minimum de commande (F)</label><input name="minimum" type="number" min="0" value="${p.minimum || ''}"></div></div><label class="switch" style="margin-top:12px"><input type="checkbox" name="actif" ${p.actif !== false ? 'checked' : ''}> Promotion active</label><div class="row" style="margin-top:12px"><button class="btn p">Enregistrer</button><button type="button" class="btn" data-act="closeModal">Annuler</button></div></form>`;
}
function vPromos() {
  const ps = all('promotions').sort((a, b) => b.createdAt - a.createdAt); state.sugs = [...suggestionsPromos(), ...state.sugsIA];
  return topbar('Promotions', `<button class="btn p sm" data-act="newPromo">${ic('plus')}Nouvelle promotion</button>`) + `<div class="card">${ps.map(p => { const u = usagePromo(p.id); return `<div class="lrow"><div style="min-width:0"><b>${esc(p.nom)}</b> <span class="mut">${promoLib(p)}</span><div class="mut" style="font-size:13px">${esc(promoConditions(p))}</div><div class="mut" style="font-size:12px">Utilisée ${u.n} fois · ${F(u.remise)} offerts</div></div><div class="row" style="flex:none">${promoEnCours(p) ? '<span class="pill ok">Active</span>' : '<span class="pill mut">Inactive</span>'}<button class="btn sm" data-act="editPromo" data-id="${p.id}">Modifier</button><button class="btn sm d" data-act="delPromo" data-id="${p.id}" title="Supprimer">${ic('x')}</button></div></div>`; }).join('') || '<p class="mut">Aucune promotion. Créez-en une ou partez d\'une idée ci-dessous.</p>'}</div>
  <div class="card ia"><div class="row" style="justify-content:space-between"><h2 style="margin:0">${ic('spark')} Idées de promotions</h2>${aiReady() ? `<button class="btn sm a" data-act="promosIA">Plus d'idées avec l'IA</button>` : ''}</div>${state.sugs.map((s, i) => `<div class="lrow"><div style="min-width:0"><b>${esc(s.nom)}</b> <span class="mut">${promoLib(s)}</span><div class="mut" style="font-size:13px">${esc(s.raison || '')}</div></div><button class="btn sm" data-act="useSug" data-i="${i}">Créer</button></div>`).join('') || '<p class="mut">Pas d\'idée pour le moment : il faut un peu plus d\'historique.</p>'}</div>`;
}

// ----- Assistant -----
function chatHTML() {
  if (!state.chat.length) return '<div class="msg bot">Bonjour patron ! Posez-moi une question sur votre pressing : argent encaissé, impayés, cousin, commandes, meilleurs clients… Je peux aussi faire le résumé de la semaine.</div>';
  return state.chat.map((m, i) => m.me ? `<div class="msg me">${esc(m.t)}</div>` : `<div class="msg bot">${esc(m.t)}${m.wait ? '' : `<div class="row" style="margin-top:8px"><button class="btn sm" data-act="speak" data-i="${i}">${ic('vol')}Écouter</button><a class="btn sm" href="#" target="_blank" rel="noopener" data-act="waChat" data-i="${i}">${ic('msg')}WhatsApp</a></div>`}</div>`).join('');
}
function renderChat() { const c = $('#chat'); if (c) { c.innerHTML = chatHTML(); c.scrollTop = c.scrollHeight; } }
function vAssistant() { return topbar('Assistant du patron') + `<div class="card"><div class="row">${["Combien j'ai encaissé ce mois ?", 'Qui me doit le plus ?', 'Combien de pièces chez le cousin ?', 'Quelles commandes sont prêtes ?', 'Résumé de la semaine'].map(q => `<button class="btn sm" data-act="askQ" data-q="${esc(q)}">${esc(q)}</button>`).join('')}</div></div><div class="card"><div id="chat" class="chat">${chatHTML()}</div><form data-form="ask" class="row" style="margin-top:12px;flex-wrap:nowrap"><input name="q" id="askq" placeholder="Posez votre question…" autocomplete="off"><button type="button" class="btn" data-act="askMic" title="Dicter">${ic('mic')}</button><button class="btn p">Envoyer</button></form>${aiReady() ? '' : '<p class="mut" style="font-size:13px">Hors ligne : je réponds aux questions courantes. Les questions libres passent par l\'IA (clé API Claude dans Paramètres).</p>'}</div>`; }

// ----- Détachage -----
const GUIDE = [
  ['Huile, graisse, huile rouge, beurre de karité', 'Saupoudrez tout de suite du talc ou de l\'amidon, laissez absorber 30 min et brossez. Mettez ensuite un peu de liquide vaisselle sur la tache, frottez doucement et lavez à l\'eau tiède.'],
  ['Terre rouge (latérite), boue', 'Laissez bien sécher, puis brossez à sec pour enlever le maximum. Prétraitez au savon et lavez à l\'eau froide. Ne frottez pas la boue mouillée : elle rentre dans les fibres.'],
  ['Sang', 'Eau FROIDE uniquement (l\'eau chaude fixe la tache). Tamponnez, puis savon et rinçage froid.'],
  ['Sueur, col et aisselles jaunis', 'Pâte de bicarbonate et d\'eau, ou vinaigre blanc dilué, 30 min avant le lavage. Brossez doucement le col.'],
  ['Encre de stylo', 'Tamponnez avec de l\'alcool à 70° sur un chiffon blanc, de l\'extérieur vers le centre. Changez souvent de chiffon.'],
  ['Rouille', 'Jus de citron et sel, au soleil quelques minutes, puis rinçage. À éviter sur les couleurs fragiles.'],
  ['Mangue, fruits, jus, sauce tomate', 'Rincez vite à l\'eau froide par l\'envers, puis savon. Plus on attend, plus la tache se fixe.'],
  ['Cire de bougie', 'Grattez la cire durcie, posez du papier absorbant dessus et passez un fer tiède.'],
  ['Précautions par tissu', 'Wax et pagne : testez la couleur sur un coin caché, eau froide, jamais de javel. Bazin : pas de javel sur les couleurs, lavage doux, amidonnez après. Soie et tissus délicats : ne frottez pas, nettoyage à sec. Dans tous les cas, testez d\'abord sur une partie cachée.']
];
function vDetachage() {
  return topbar('Conseils de détachage') + `<div class="card"><form data-form="detachage"><label>Photo de la tache</label><input type="file" accept="image/*" capture="environment" data-act-change="detPhoto"><img id="detPrev" alt="" style="max-width:220px;border-radius:10px;margin-top:8px" ${state.detPhoto ? `src="${state.detPhoto}"` : 'hidden'}><div class="f2"><div><label>Tissu</label><select name="tissu">${['Inconnu', 'Coton', 'Wax / pagne', 'Bazin', 'Soie', 'Laine', 'Synthétique', 'Jean', 'Lin'].map(t => `<option>${t}</option>`).join('')}</select></div><div><label>Couleur</label><input name="couleur" placeholder="Ex. blanc, bleu indigo…"></div></div><label>Tache supposée (facultatif)</label><input name="tache" placeholder="Ex. huile rouge, encre…"><button class="btn p" style="margin-top:12px">${ic('spark')}Analyser avec l'IA</button></form></div><div id="detRes"></div>
  <div class="card"><h2>Guide rapide (fonctionne hors ligne)</h2>${GUIDE.map(([t, x]) => `<details><summary>${esc(t)}</summary><p style="margin:8px 0 0">${esc(x)}</p></details>`).join('')}</div>`;
}

// ----- Plus -----
function vPlus() { return topbar('Plus') + `<div class="grid">${NAV.filter(n => !n[3] || isAdmin()).map(n => `<a class="card" href="#/${n[0]}" style="text-decoration:none;color:inherit;margin:0;display:flex;gap:10px;align-items:center">${ic(n[2])}<b>${n[1]}</b></a>`).join('')}</div><div class="card">${esc(currentUser().nom)} · ${isAdmin() ? 'Admin' : 'Employé'} <button class="btn sm" data-act="logout">Changer d'utilisateur</button></div>`; }

// ----- Paramètres -----
function vParametres() {
  const S = db.settings, c = cfg(), adm = isAdmin();
  const cl = getCloud(), l = safeGet('cloudLast', null);
  let h = topbar('Paramètres') + `<div class="card"><h2>${ic('cloud')} Sauvegarde automatique en ligne</h2><p class="mut" style="margin-top:0">Chaque soir à partir de 19 h, dès que l'appli est ouverte avec internet, une copie <b>chiffrée</b> de toutes les données (photos comprises) part dans Supabase, bucket « saves ».${l ? `<br>Dernier envoi : ${l.ok ? 'réussi le ' + new Date(l.at).toLocaleString('fr-FR') : 'échec (' + esc(l.error || '') + ')'}` : ''}</p>
   ${adm ? `<details><summary>Guide pas à pas (une seule fois)</summary><ol style="padding-left:18px"><li>Créez un compte gratuit sur supabase.com, puis un projet.</li><li>Ouvrez <b>SQL Editor</b>, collez le code ci-dessous et cliquez sur <b>Run</b> : il crée le dossier « saves » et ses règles d'accès.</li><li>Dans <b>Project Settings › API</b>, copiez l'adresse du projet et la clé publique (anon ou publishable).</li><li>Choisissez un mot de passe de sauvegarde et <b>notez-le</b> : sans lui, impossible de restaurer.</li></ol><textarea id="mtxt" rows="6" readonly>${esc(cloud.SETUP_SQL)}</textarea><button type="button" class="btn sm" data-act="copyTxt" style="margin:6px 0 10px">Copier le code</button></details>
   <form data-form="cloud"><label>Adresse du projet</label><input name="url" placeholder="https://xxxx.supabase.co" value="${esc(cl.url)}"><label>Clé publique</label><input name="key" value="${esc(cl.key)}" autocomplete="off"><label>Mot de passe de sauvegarde</label><input name="password" type="password" value="${esc(cl.password)}" autocomplete="new-password"><label class="switch" style="margin-top:10px"><input type="checkbox" name="enabled" ${cl.enabled ? 'checked' : ''}> Sauvegarde automatique activée</label><div class="row" style="margin-top:10px"><button class="btn p">Enregistrer</button><button type="button" class="btn" data-act="cloudNow">Sauvegarder maintenant</button><button type="button" class="btn" data-act="cloudRestore">Restaurer depuis internet</button></div></form>` : '<p class="mut">Réglage réservé à l\'administrateur.</p>'}</div>`;
  if (adm) h += `<div class="card"><h2>${ic('spark')} Intelligence artificielle</h2><p class="mut" style="margin-top:0">Photo des vêtements, dictée, relances, idées de promotions, assistant et détachage. Il faut une clé API Claude (console.anthropic.com) ; chaque utilisation est payée sur ce compte (quelques francs). La clé reste dans ce téléphone.</p><form data-form="iacfg"><label>Clé API Claude</label><input name="iaKey" type="password" value="${esc(cfg().iaKey)}" placeholder="sk-ant-…" autocomplete="off"><label class="switch" style="margin-top:10px"><input type="checkbox" name="ia" ${cfg().ia !== false ? 'checked' : ''}> IA activée</label><div class="row" style="margin-top:10px"><button class="btn p">Enregistrer</button><button type="button" class="btn" data-act="iaTest">Tester</button></div></form></div>`;
  if (!adm) return h + '<div class="card mut">Les autres réglages sont réservés à l\'administrateur.</div>';
  h += `<div class="card"><h2>Le pressing</h2><form data-form="reglages"><div class="f2"><div><label>Nom du pressing</label><input name="nom" value="${esc(S.nom)}"></div><div><label>WhatsApp du patron</label><input name="tel" inputmode="tel" value="${esc(S.tel)}"></div></div><label>Adresse</label><input name="adresse" value="${esc(S.adresse)}">
   <div class="f2"><div><label>Numéro MTN MoMo</label><input name="mtn" inputmode="tel" value="${esc(S.momo.mtn)}"></div><div><label>Numéro Moov Money</label><input name="moov" inputmode="tel" value="${esc(S.momo.moov)}"></div></div><div class="f2"><div><label>Numéro Celtiis Cash</label><input name="celtiis" inputmode="tel" value="${esc(S.momo.celtiis)}"></div><div></div></div>
   <div class="f2"><div><label>Nom du cousin (sous-traitant)</label><input name="cnom" value="${esc(S.cousin.nom)}"></div><div><label>WhatsApp du cousin</label><input name="ctel" inputmode="tel" value="${esc(S.cousin.tel)}"></div></div>
   <div class="f2"><div><label>Capacité de l'atelier (pièces/jour)</label><input name="capaciteJour" type="number" min="1" value="${S.capaciteJour}"></div><div><label>Majoration express (%)</label><input name="express" type="number" min="0" value="${S.expressMajoration}"></div></div>
   <label>Mois de saison des pluies (séchage plus long)</label><div class="row">${MOIS.map((m, i) => `<label class="switch" style="font-weight:500"><input type="checkbox" name="m${i + 1}" ${S.moisPluies.includes(i + 1) ? 'checked' : ''}>${m}</label>`).join('')}</div>
   <button class="btn p" style="margin-top:12px">Enregistrer</button></form></div>
  <div class="card"><div class="row" style="justify-content:space-between"><h2 style="margin:0">Tarifs et articles</h2><button class="btn sm" data-act="addCat">${ic('plus')}Article</button></div><div style="overflow:auto"><table class="t"><tr><th>Article</th><th>Prix (F)</th><th>Délai (j)</th><th>Cousin par défaut</th><th>Coût cousin (F)</th><th></th></tr>${S.catalogue.map((x, i) => `<tr><td><input data-cat="${i}" data-ck="nom" value="${esc(x.nom)}" style="min-width:140px"></td><td><input data-cat="${i}" data-ck="prix" type="number" min="0" value="${x.prix}" style="width:90px"></td><td><input data-cat="${i}" data-ck="delai" type="number" min="1" value="${x.delai}" style="width:64px"></td><td><input data-cat="${i}" data-ck="cousin" type="checkbox" ${x.cousin ? 'checked' : ''} style="width:auto"></td><td><input data-cat="${i}" data-ck="coutCousin" type="number" min="0" value="${x.coutCousin || 0}" style="width:90px"></td><td><button class="btn sm d" data-act="delCat" data-i="${i}">${ic('x')}</button></td></tr>`).join('')}</table></div><p class="mut" style="font-size:13px">Les prix sont des exemples : mettez vos vrais tarifs. Les changements sont enregistrés tout de suite.</p></div>
  <div class="card"><h2>Utilisateurs</h2>${S.users.map(u => `<div class="lrow"><span><b>${esc(u.nom)}</b> <span class="pill ${u.role === 'admin' ? '' : 'mut'}">${u.role === 'admin' ? 'Admin' : 'Employé'}</span></span><span class="row"><button class="btn sm" data-act="pinUser" data-id="${u.id}">Changer le PIN</button>${u.id !== currentUser().id ? `<button class="btn sm d" data-act="delUser" data-id="${u.id}">${ic('x')}</button>` : ''}</span></div>`).join('')}
   <form data-form="user" class="row" style="margin-top:10px;align-items:flex-end"><div style="flex:2;min-width:140px"><label>Nom</label><input name="nom" required></div><div style="flex:1;min-width:110px"><label>Rôle</label><select name="role"><option value="employe">Employé</option><option value="admin">Admin</option></select></div><div style="flex:1;min-width:100px"><label>PIN</label><input name="pin" inputmode="numeric" required placeholder="4 à 6 chiffres"></div><button class="btn p">Ajouter</button></form></div>
  <div class="card"><h2>Sauvegarde de secours</h2><div class="row"><button class="btn" data-act="export">Télécharger une copie (JSON)</button><label class="btn" style="margin:0;color:var(--ink);font-size:15px">Importer une copie<input type="file" accept="application/json,.json" data-act-change="import" hidden></label>${db.clients.some(c => c.demo && !c.deleted) ? '<button class="btn d" data-act="demoOff">Supprimer les données de démo</button>' : '<button class="btn" data-act="demo">Charger des données de démo</button>'}</div></div>`;
  return h;
}

// ---------- Rendu ----------
const VIEWS = {
  accueil: { r: vAccueil }, nouvelle: { r: vNouvelle, after: () => { renderCRes(); loadPhotos(); } }, commandes: { r: vCommandes },
  facture: { r: () => vFacture(state.param), after: loadPhotos }, clients: { r: vClients }, client: { r: () => vClient(state.param) },
  recouvrement: { r: vRecouvrement }, cousin: { r: vCousin }, promos: { r: vPromos, admin: true }, assistant: { r: vAssistant, admin: true, after: renderChat },
  detachage: { r: vDetachage }, parametres: { r: vParametres }, plus: { r: vPlus }
};
function render() {
  const app = $('#app');
  if (!currentUser()) { app.innerHTML = vLogin(); return; }
  const V = VIEWS[state.view] || VIEWS.accueil;
  if (V.admin && !isAdmin()) { app.innerHTML = shell(topbar('Accès réservé') + '<div class="card">Cette page est réservée à l\'administrateur.</div>'); return; }
  app.innerHTML = shell(V.r()); V.after && V.after();
}

// ---------- Actions ----------
const ACT = {}, FORMS = {}, ACT_CHANGE = {};
ACT.modalBg = (a, e) => { if (e.target === a) closeModal(); };
ACT.closeModal = closeModal;
ACT.logout = () => { safeSet(LS_USER, null); render(); };
ACT.copyTxt = () => { const t = $('#mtxt'); if (!t) return; (navigator.clipboard ? navigator.clipboard.writeText(t.value) : Promise.reject()).then(() => toast('Texte copié')).catch(() => { t.select(); try { document.execCommand('copy'); toast('Texte copié'); } catch { } }); };
ACT.sendWa = a => { const txt = $('#mtxt')?.value || ''; if (isNative) { a.setAttribute('href', '#'); waOpen(a.dataset.wa, txt, {}); } else a.href = wa(a.dataset.wa, txt); if (a.dataset.rel) { const c = get('clients', a.dataset.rel); if (c) { c.derniereRelance = Date.now(); put('clients', c); } } };
ACT.zoomPhoto = a => modal(`<img src="${a.src}" alt="" style="width:100%;border-radius:12px"><p class="mut">Photo prise au dépôt, avec date et heure : c'est votre preuve de l'état du vêtement.</p><button class="btn" data-act="closeModal">Fermer</button>`);
// Nouvelle facture
ACT.pickClient = a => { state.draft.clientId = a.dataset.id; state.draft.clientNom = ''; state.cq = ''; render(); };
ACT.clearClient = () => { state.draft.clientId = null; render(); };
ACT.addLigne = () => { const it = db.settings.catalogue[0] || { nom: 'Article', prix: 0 }; state.draft.lignes.push({ id: uid(), article: it.nom, qte: 1, prix: it.prix, notes: '', cousin: false }); render(); };
ACT.delLigne = a => { state.draft.lignes.splice(+a.dataset.i, 1); render(); };
ACT.cousinMode = a => { const d = state.draft; d.envoiCousin = a.dataset.v === '1'; if (!d.envoiCousin) d.lignes.forEach(l => l.cousin = false); render(); };
ACT.applySugCousin = () => { const d = state.draft; d.envoiCousin = true; d.lignes.forEach(l => { if (suggestionCousin(l.article).oui) l.cousin = true; }); render(); };
ACT.draftReset = async () => { if (await confirmBox('Effacer toute la facture en cours ?')) { state.draft = newDraft(); state.cq = ''; render(); } };
ACT.dateAuto = () => { state.draft.dateManuelle = false; render(); };
ACT.newFactClient = a => { state.draft = newDraft(a.dataset.id); go('nouvelle'); };
ACT.dictee = () => {
  const z = $('#dicteeZone');
  if (!$('#dtxt')) z.innerHTML = `<div class="card ia" style="margin:10px 0 0"><b>Dictez la commande</b> <span class="mut">ex. « trois chemises, deux pantalons, un boubou bazin, express, pour Madame Houngbo »</span><textarea id="dtxt" rows="2" style="margin-top:6px" placeholder="Le texte dicté apparaît ici (vous pouvez aussi le taper)"></textarea><div class="row" style="margin-top:6px"><button class="btn sm p" data-act="dicteeOk">Ajouter ces articles</button><button class="btn sm" data-act="dictee">${ic('mic')}Parler encore</button></div></div>`;
  ecouter(t => { const ta = $('#dtxt'); if (ta) ta.value = (ta.value ? ta.value + ', ' : '') + t; });
};
ACT.dicteeOk = async () => {
  const txt = $('#dtxt')?.value.trim(), d = state.draft; if (!txt) return toast('Dictez ou tapez la commande.');
  let r = null;
  if (aiReady()) { toast('L\'IA lit la commande…'); try { r = await ai('dictee', { texte: txt, catalogue: db.settings.catalogue.map(c => c.nom), clients: all('clients').map(c => c.nom).slice(0, 300) }); } catch (e) { console.warn(e); } }
  if (!r || !Array.isArray(r.lignes)) r = parseDictee(txt);
  let n = 0;
  r.lignes.forEach(x => { const it = catItem(x.article); if (!it) return; d.lignes.push({ id: uid(), article: it.nom, qte: Math.max(1, +x.qte || 1), prix: it.prix, notes: '', cousin: false }); n++; });
  if (r.express) d.express = true;
  if (r.client && !d.clientId) { const c = all('clients').find(c => norm(c.nom) === norm(r.client)) || all('clients').find(c => norm(c.nom).includes(norm(r.client))); if (c) d.clientId = c.id; else d.clientNom = r.client; }
  render(); toast(n ? `${n} article(s) ajouté(s). Vérifiez avant d'enregistrer.` : 'Aucun article reconnu. Essayez avec les noms du catalogue.');
};
ACT_CHANGE.photoLigne = async t => {
  const file = t.files[0]; if (!file) return; const d = state.draft, cat = db.settings.catalogue;
  const dataUrl = await compressImage(file), pid = 'ph_' + uid(); await photoSave(pid, dataUrl);
  const l = { id: uid(), article: cat[0]?.nom || 'Article', qte: 1, prix: cat[0]?.prix || 0, photoId: pid, notes: '', cousin: false };
  d.lignes.push(l); render();
  if (!aiReady()) return toast('Photo ajoutée. Choisissez l\'article (IA hors ligne).');
  toast('L\'IA analyse la photo…');
  try {
    const r = await ai('photo_article', { image: dataUrl.split(',')[1], catalogue: cat.map(c => c.nom) });
    const it = catItem(r.article); if (it) { l.article = it.nom; l.prix = it.prix; }
    const notes = [...(r.taches || []).map(x => 'tache : ' + x), ...(r.degats || []).map(x => 'dégât : ' + x)].join(', ');
    if (notes) l.notes = notes;
    l.ia = [r.article, r.couleur, r.confiance ? 'confiance ' + r.confiance : ''].filter(Boolean).join(' · ');
    if (state.view === 'nouvelle') render(); toast('Article reconnu : ' + l.article);
  } catch (e) { toast('IA indisponible : choisissez l\'article à la main.'); }
};
ACT.saveFacture = () => {
  const d = state.draft, u = currentUser();
  if (!d.lignes.length && !(+d.arriere.montant)) return toast('Ajoutez au moins un article (ou un arriéré).');
  if (+d.remiseManuelle > 0 && !d.remiseMotif.trim()) return toast('Indiquez le motif de la remise.');
  let cid = d.clientId;
  if (!cid) { if (!d.clientNom.trim()) return toast('Choisissez ou créez le client.'); cid = put('clients', { nom: d.clientNom.trim(), tel: d.clientTel.trim(), createdAt: Date.now() }).id; }
  d.clientId = cid; choosePromo(d); const c = calcFacture(d);
  const f = {
    id: d.id, numero: numeroFacture(), code: String(Math.floor(1000 + Math.random() * 9000)), clientId: cid, type: 'normale', createdAt: Date.now(), createdBy: u.id,
    lignes: d.lignes.map(l => { const cous = d.envoiCousin && !!l.cousin; return { id: l.id || uid(), article: l.article, qte: +l.qte || 1, prix: +l.prix || 0, montant: (+l.prix || 0) * (+l.qte || 1), notes: l.notes || '', photoId: l.photoId || null, cousin: cous, cousinStatut: cous ? 'a_envoyer' : null }; }),
    express: d.express, promoId: c.remisePromo ? d.promoId : null, remisePromo: c.remisePromo, remiseManuelle: c.remiseManuelle, remiseMotif: d.remiseMotif, majoration: c.maj,
    arriere: c.arriere ? { montant: c.arriere, motif: d.arriere.motif } : null, sousTotal: c.sousTotal, total: c.total,
    dateRetrait: d.lignes.length ? d.dateRetrait : null, statut: d.lignes.length ? 'recu' : 'retire', paiements: [], annulee: false
  };
  if (+d.acompte > 0) f.paiements.push({ id: uid(), montant: Math.min(+d.acompte, c.total), mode: d.modeAcompte, date: Date.now(), user: u.id });
  put('factures', f); if (c.remiseManuelle) logJ('remise', f, c.remiseManuelle, d.remiseMotif);
  state.draft = null; state.cq = ''; toast('Facture ' + f.numero + ' enregistrée'); go('facture', f.id);
};
// Commandes & facture
ACT.filtre = a => { state.filtre = a.dataset.v; render(); };
ACT.statut = async a => {
  const f = get('factures', a.dataset.id), s = a.dataset.s; if (f.statut === s) return;
  if (s === 'retire') {
    if (reste(f) > 0 && !await confirmBox(`Il reste ${F(reste(f))} à payer. Remettre quand même les habits ?`, 'Oui, remettre', 'Non')) return;
    const code = await promptBox('Code de retrait donné par le client (laissez vide pour passer) :', 'text');
    if (code && code !== f.code && !await confirmBox('Code incorrect ! Remettre quand même ?', 'Oui', 'Non')) return;
    if (reste(f) > 0) logJ('retrait_impaye', f, reste(f)); f.retireAt = Date.now();
  }
  f.statut = s; put('factures', f); render();
  if (s === 'pret') { const c = get('clients', f.clientId); if (c) modal(waModal('Prévenir ' + c.nom + ' que c\'est prêt ?', msgPret(f, c), c.tel)); }
};
FORMS.paiement = v => { const f = get('factures', v.id), m = +v.montant; if (!(m > 0)) return toast('Montant invalide'); f.paiements = f.paiements || []; f.paiements.push({ id: uid(), montant: Math.min(m, reste(f)), mode: v.mode, date: Date.now(), user: currentUser().id }); put('factures', f); logJ('paiement', f, m, v.mode); toast('Paiement de ' + F(m) + ' enregistré'); render(); };
ACT.delPaiement = async a => { if (!await confirmBox('Supprimer ce paiement ?')) return; const f = get('factures', a.dataset.f), p = f.paiements.find(x => x.id === a.dataset.p); f.paiements = f.paiements.filter(x => x.id !== a.dataset.p); put('factures', f); logJ('paiement_supprime', f, p?.montant); render(); };
ACT.annuler = async a => { const f = get('factures', a.dataset.id), motif = await promptBox('Motif de l\'annulation :'); if (!motif) return; Object.assign(f, { annulee: true, annuleMotif: motif, annuleBy: currentUser().id, annuleAt: Date.now() }); put('factures', f); logJ('annulation', f, f.total, motif); toast('Facture annulée'); render(); };
ACT.recuWa = a => { const f = get('factures', a.dataset.id), c = get('clients', f.clientId); modal(waModal('Envoyer le reçu', msgRecu(f, c), c?.tel)); };
ACT.lienPaiement = async a => {
  const f = get('factures', a.dataset.id), c = get('clients', f.clientId), r = reste(f); let lien = '';
  modal(waModal('Demander le paiement', `Bonjour ${c?.nom || ''}, voici le paiement de votre facture ${f.numero} chez ${db.settings.nom} : ${F(r)}. ${lien ? 'Payez en ligne (MoMo, Moov, carte) : ' + lien : infosPaiement()} Merci !`.replace(/\s+/g, ' '), c?.tel));
};
ACT.imprimer = a => {
  if (isNative) { const f = get('factures', a.dataset.id); return shareText(msgRecu(f, get('clients', f.clientId)), 'Reçu ' + f.numero); } // vers WhatsApp ou l'imprimante Bluetooth (RawBT)
  const f = get('factures', a.dataset.id), c = get('clients', f.clientId), S = db.settings;
  $('#print').innerHTML = `<div style="font-family:monospace;max-width:300px;font-size:13px;line-height:1.5"><h3 style="margin:0">${esc(S.nom)}</h3><div>${esc(S.adresse)} ${esc(S.tel)}</div><hr>Facture ${esc(f.numero)}<br>${new Date(f.createdAt).toLocaleString('fr-FR')}<br>Client : ${esc(c?.nom)} ${esc(c?.tel || '')}<hr>${f.lignes.map(l => `${l.qte} x ${esc(l.article)} : ${F(l.montant)}${l.notes ? '<br><small>' + esc(l.notes) + '</small>' : ''}`).join('<br>')}${f.arriere ? `<br>Arriéré : ${F(f.arriere.montant)}` : ''}${f.remisePromo ? `<br>Promotion : -${F(f.remisePromo)}` : ''}${f.remiseManuelle ? `<br>Remise : -${F(f.remiseManuelle)}` : ''}<hr><b>Total : ${F(f.total)}</b><br>Payé : ${F(paye(f))}<br>Reste : ${F(reste(f))}<br>${f.dateRetrait ? 'Retrait prévu : ' + dFR(f.dateRetrait) + '<br>' : ''}<b>Code de retrait : ${f.code}</b><hr>${esc(infosPaiement())}<br>Merci de votre confiance !</div>`;
  document.body.classList.add('printing'); setTimeout(() => { try { window.print(); } catch { toast('Impression impossible ici'); } document.body.classList.remove('printing'); }, 60);
};
ACT.toCousin = a => { const f = get('factures', a.dataset.f), l = f.lignes.find(x => x.id === a.dataset.l); l.cousin = true; l.cousinStatut = 'a_envoyer'; put('factures', f); toast('Ajouté à la liste pour le cousin'); render(); };
// Cousin
ACT.envoyerCousin = () => {
  const aEnv = lignesCousin().filter(x => x.l.cousinStatut === 'a_envoyer'), S = db.settings, now = Date.now(), touched = new Set();
  const txt = `Bonjour ${S.cousin.nom}, voici les habits envoyés par ${S.nom} le ${new Date().toLocaleDateString('fr-FR')} :\n` + aEnv.map(x => `- ${x.l.qte} × ${x.l.article} (${x.f.numero} · ${clientNom(x.f.clientId)})${x.l.notes ? ' : ' + x.l.notes : ''}`).join('\n') + `\nTotal : ${sumQ(aEnv)} pièce(s). Merci !`;
  aEnv.forEach(x => { x.l.cousinStatut = 'chez_cousin'; x.l.sentAt = now; if (x.f.statut === 'recu') x.f.statut = 'en_cours'; touched.add(x.f); });
  touched.forEach(f => put('factures', f)); render(); modal(waModal('Bordereau pour le cousin', txt, S.cousin.tel));
};
ACT.cousinRevenu = a => { const f = get('factures', a.dataset.f), l = f.lignes.find(x => x.id === a.dataset.l); l.cousinStatut = 'revenu'; l.backAt = Date.now(); put('factures', f); toast('Pièce revenue du cousin'); render(); };
ACT.cousinGarder = a => { const f = get('factures', a.dataset.f), l = f.lignes.find(x => x.id === a.dataset.l); l.cousin = false; l.cousinStatut = null; put('factures', f); render(); };
// Clients
ACT.newClient = () => modal(clientForm());
ACT.editClient = a => modal(clientForm(get('clients', a.dataset.id)));
FORMS.client = v => { const old = v.id ? get('clients', v.id) : { createdAt: Date.now() }; const c = put('clients', { ...old, id: v.id || undefined, nom: v.nom.trim(), tel: v.tel.trim(), quartier: v.quartier.trim(), notes: v.notes.trim() }); closeModal(); toast('Client enregistré'); if (!v.id) go('client', c.id); else render(); };
ACT.arriereClient = a => modal(`<h2>Ajouter un arriéré</h2><p class="mut">Pour une ancienne dette de ce client (cahier, avant l'application…).</p><form data-form="arriere"><input type="hidden" name="cid" value="${a.dataset.id}"><label>Montant</label><input name="m" type="number" min="1" inputmode="numeric" required><label>Motif</label><input name="motif" placeholder="Ex. dette du cahier, 2025"><div class="row" style="margin-top:12px"><button class="btn p">Ajouter</button><button type="button" class="btn" data-act="closeModal">Annuler</button></div></form>`);
FORMS.arriere = v => { const m = +v.m; if (!(m > 0)) return; const f = put('factures', { numero: numeroFacture(), type: 'arriere', clientId: v.cid, createdAt: Date.now(), createdBy: currentUser().id, lignes: [], arriere: { montant: m, motif: v.motif }, sousTotal: 0, total: m, statut: 'retire', paiements: [], annulee: false, code: '' }); logJ('arriere', f, m, v.motif); closeModal(); toast('Arriéré de ' + F(m) + ' ajouté'); render(); };
// Recouvrement
ACT.relance = a => { const c = get('clients', a.dataset.id), r = risqueClient(c.id); modal(`<h2>Relancer ${esc(c.nom)} · ${F(r.solde)}</h2><p class="mut" style="margin-top:0">${esc(momentRelance().txt)}</p><div class="row"><button class="btn sm" data-act="relTon" data-id="${c.id}" data-t="poli">Ton poli</button><button class="btn sm" data-act="relTon" data-id="${c.id}" data-t="ferme">Ton ferme</button>${aiReady() ? `<button class="btn sm a" data-act="relIA" data-id="${c.id}">${ic('spark')}Rédiger avec l'IA</button>` : ''}</div><div style="margin-top:8px">${waModal('', messageRelance(c, r, r.score >= 60 ? 'ferme' : 'poli'), c.tel, c.id).replace('<h2></h2>', '')}</div>`); };
ACT.relTon = a => { const c = get('clients', a.dataset.id); $('#mtxt').value = messageRelance(c, risqueClient(c.id), a.dataset.t); };
ACT.relIA = async a => { const c = get('clients', a.dataset.id), r = risqueClient(c.id), t = $('#mtxt'); t.value = 'Rédaction en cours…'; try { t.value = await ai('relance', { client: { nom: c.nom, doit: F(r.solde), jours_de_retard: r.jours, nb_factures: r.nb, profil: r.label }, ton: r.score >= 60 ? 'ferme mais respectueux' : 'amical', pressing: db.settings.nom, paiement: infosPaiement() }); } catch (e) { t.value = messageRelance(c, r, 'poli'); toast('IA indisponible'); } };
// Caisse
ACT.cloture = () => { const adm = isAdmin(), a = cashAttendu(today()); modal(`<h2>Clôture de caisse — ${dFR(new Date())}</h2><form data-form="cloture"><p class="mut" style="margin-top:0">Comptez l'argent liquide (sans le fond de caisse) et notez le total Mobile Money reçu aujourd'hui d'après les SMS.</p><label>Espèces comptées</label><input name="esp" type="number" min="0" inputmode="numeric" required><label>Mobile Money reçu (facultatif)</label><input name="momo" type="number" min="0" inputmode="numeric"><label>Remarque</label><input name="note">${adm ? `<p class="mut" style="font-size:13px">Enregistré dans l'application : espèces ${F(a.esp)}, Mobile Money ${F(a.momo)}.</p>` : ''}<div class="row" style="margin-top:12px"><button class="btn p">Valider</button><button type="button" class="btn" data-act="closeModal">Annuler</button></div></form>`); };
FORMS.cloture = v => { const a = cashAttendu(today()), c = put('clotures', { date: today(), user: currentUser().id, especesDeclarees: +v.esp || 0, especesAttendues: a.esp, momoDeclare: v.momo === '' ? null : +v.momo, momoAttendu: a.momo, note: v.note, createdAt: Date.now() }); closeModal(); const e = c.especesDeclarees - c.especesAttendues; toast(isAdmin() ? (Math.abs(e) < 500 ? 'Caisse juste. Bravo !' : 'Écart de caisse : ' + F(e)) : 'Clôture enregistrée. Merci !'); render(); };
// Promotions
ACT.newPromo = () => modal(promoForm());
ACT.editPromo = a => modal(promoForm(get('promotions', a.dataset.id)));
ACT.delPromo = async a => { if (!await confirmBox('Supprimer cette promotion ?')) return; const p = get('promotions', a.dataset.id); p.deleted = true; put('promotions', p); render(); };
ACT.useSug = a => modal(promoForm({ ...state.sugs[+a.dataset.i], actif: true }));
FORMS.promo = v => { const S = db.settings, old = v.id ? get('promotions', v.id) : { createdAt: Date.now() }; put('promotions', { ...old, id: v.id || undefined, nom: v.nom.trim(), type: v.type, valeur: +v.valeur, debut: v.debut || '', fin: v.fin || '', jours: JOURS.map((_, i) => v['j' + i] ? i : null).filter(x => x !== null), articles: S.catalogue.filter((c, i) => v['a' + i]).map(c => c.nom), cible: v.cible, minimum: +v.minimum || 0, actif: !!v.actif }); closeModal(); toast('Promotion enregistrée'); render(); };
ACT.promosIA = async () => {
  toast('L\'IA cherche des idées…');
  const fs = all('factures').filter(f => !f.annulee && f.type !== 'arriere' && f.createdAt > Date.now() - 56 * 864e5), by = [0, 0, 0, 0, 0, 0, 0]; fs.forEach(f => by[new Date(f.createdAt).getDay()] += f.total);
  try {
    const r = await ai('promos', { date: today(), stats: { chiffre_par_jour_8_semaines: Object.fromEntries(JOURS.map((j, i) => [j, by[i]])), panier_moyen: fs.length ? Math.round(fs.reduce((s, f) => s + f.total, 0) / fs.length) : 0, clients_inactifs_2_mois: all('clients').filter(c => { const l = dernierPassage(c.id); return l && Date.now() - l > 60 * 864e5; }).length, articles: topArticles(90), catalogue: db.settings.catalogue.map(c => c.nom + ' ' + c.prix + ' F'), promotions_existantes: all('promotions').map(p => p.nom) }, evenements: evenementsProches(75).map(e => ({ nom: e.nom, date: ymd(e.date), approximative: !!e.approx })) });
    state.sugsIA = (Array.isArray(r) ? r : []).map(s => ({ ...s, valeur: +s.valeur || 10, articles: (s.articles || []).filter(n => catItem(n)).map(n => catItem(n).nom) })); render(); toast(state.sugsIA.length + ' idée(s) ajoutée(s)');
  } catch (e) { toast('IA : ' + e.message); }
};
// Assistant
FORMS.ask = async (v, f) => {
  const q = (v.q || '').trim(); if (!q) return; f && f.reset();
  state.chat.push({ me: true, t: q }); renderChat();
  let ans = repondreLocal(q);
  if (!ans) {
    if (aiReady()) { state.chat.push({ t: 'Je réfléchis…', wait: true }); renderChat(); try { ans = await ai('assistant', { question: q, donnees: resumeDonnees() }); } catch (e) { ans = 'Je n\'ai pas pu joindre l\'IA (' + e.message + ').'; } state.chat = state.chat.filter(m => !m.wait); }
    else ans = 'Hors ligne, je réponds sur : argent encaissé, impayés, cousin, commandes prêtes, meilleurs clients et résumé de la semaine. Pour les autres questions, ajoutez la clé API Claude dans Paramètres.';
  }
  state.chat.push({ t: ans }); renderChat();
};
ACT.askQ = a => FORMS.ask({ q: a.dataset.q });
ACT.askMic = () => ecouter(t => FORMS.ask({ q: t }));
ACT.speak = a => parler(state.chat[+a.dataset.i].t);
ACT.waChat = a => { const t = state.chat[+a.dataset.i].t; if (isNative) { a.setAttribute('href', '#'); waOpen(db.settings.tel, t, {}); } else a.href = wa(db.settings.tel, t); };
// Détachage
ACT_CHANGE.detPhoto = async t => { if (!t.files[0]) return; state.detPhoto = await compressImage(t.files[0], 900, 0.7); const i = $('#detPrev'); i.src = state.detPhoto; i.hidden = false; };
FORMS.detachage = async v => {
  const z = $('#detRes');
  if (!aiReady()) { z.innerHTML = '<div class="card ia">IA hors ligne : utilisez le guide rapide ci-dessous.</div>'; return; }
  if (!state.detPhoto) { z.innerHTML = '<div class="card ia">Ajoutez d\'abord une photo de la tache.</div>'; return; }
  z.innerHTML = '<div class="card ia">Analyse en cours…</div>';
  try { const r = await ai('detachage', { image: state.detPhoto.split(',')[1], tissu: v.tissu, couleur: v.couleur, tache: v.tache }); z.innerHTML = `<div class="card ia" style="white-space:pre-wrap">${esc(r)}</div>`; }
  catch (e) { z.innerHTML = `<div class="card">Erreur IA : ${esc(e.message)}</div>`; }
};
// Paramètres
FORMS.login = v => { const u = db.settings.users.find(x => x.id === v.u); if (!u || u.pin !== v.pin) return toast('Code PIN incorrect'); safeSet(LS_USER, u.id); render(); };
FORMS.reglages = v => { const S = db.settings; Object.assign(S, { nom: v.nom.trim() || 'MonPressing', tel: v.tel.trim(), adresse: v.adresse.trim(), momo: { mtn: v.mtn.trim(), moov: v.moov.trim(), celtiis: v.celtiis.trim() }, cousin: { nom: v.cnom.trim(), tel: v.ctel.trim() }, capaciteJour: +v.capaciteJour || 40, expressMajoration: +v.express || 0, moisPluies: MOIS.map((_, i) => v['m' + (i + 1)] ? i + 1 : null).filter(Boolean) }); saveSettings(); toast('Réglages enregistrés'); render(); };
ACT.addCat = () => { db.settings.catalogue.push({ nom: 'Nouvel article', prix: 500, delai: 2, cousin: false, coutCousin: 0 }); saveSettings(); render(); };
ACT.delCat = async a => { if (!await confirmBox('Retirer cet article du catalogue ?')) return; db.settings.catalogue.splice(+a.dataset.i, 1); saveSettings(); render(); };
FORMS.user = v => { if (!/^\d{4,6}$/.test(v.pin)) return toast('Le PIN doit avoir 4 à 6 chiffres'); db.settings.users.push({ id: uid(), nom: v.nom.trim(), role: v.role, pin: v.pin }); saveSettings(); toast('Utilisateur ajouté'); render(); };
ACT.pinUser = async a => { const p = await promptBox('Nouveau code PIN (4 à 6 chiffres) :', 'password'); if (!p) return; if (!/^\d{4,6}$/.test(p)) return toast('Le PIN doit avoir 4 à 6 chiffres'); db.settings.users.find(u => u.id === a.dataset.id).pin = p; saveSettings(); toast('PIN modifié'); render(); };
ACT.delUser = async a => { const us = db.settings.users, u = us.find(x => x.id === a.dataset.id); if (u.role === 'admin' && us.filter(x => x.role === 'admin').length < 2) return toast('Il faut garder au moins un administrateur'); if (!await confirmBox('Supprimer ' + u.nom + ' ?')) return; db.settings.users = us.filter(x => x.id !== u.id); saveSettings(); render(); };
ACT.export = async () => { const r = await shareFile(new Blob([JSON.stringify(await exportAll())], { type: 'application/json' }), 'monpressing-' + today() + '.json', 'Sauvegarde MonPressing'); if (r !== 'cancelled') { safeSet('lastExport', new Date().toISOString()); toast('Sauvegarde créée : gardez-la sur WhatsApp, Drive ou par e-mail'); render(); } };
ACT_CHANGE.import = async t => { try { const d = JSON.parse(await t.files[0].text()); t.value = ''; if (!await confirmBox('Remplacer toutes les données de ce téléphone par cette sauvegarde ?', 'Oui, restaurer', 'Annuler')) return; await importAll(d); toast('Sauvegarde restaurée'); render(); } catch (e) { toast('Restauration impossible : ' + e.message); } };
ACT.demo = () => {
  const noms = [['Mme Houngbo Rachelle', '0197112233', 'Cadjèhoun'], ['M. Agossou Fidèle', '0166445511', 'Fidjrossè'], ['Mme Dossou Clarisse', '0195887766', 'Akpakpa'], ['M. Akpovi Serge', '0161223344', 'Gbégamey'], ['Mlle Zinsou Prisca', '0190556677', 'Zogbo'], ['M. Adjovi Landry', '0167889900', 'Calavi']];
  const cs = noms.map(([nom, tel, quartier]) => put('clients', { nom, tel, quartier, demo: true, createdAt: Date.now() - 90 * 864e5 }));
  const cat = db.settings.catalogue, u = currentUser().id;
  for (let i = 0; i < 26; i++) {
    const c = cs[i % cs.length], t = Date.now() - Math.floor(Math.random() * 60) * 864e5 - 3600e3, age = (Date.now() - t) / 864e5, lignes = [];
    for (let k = 0, n = 1 + Math.floor(Math.random() * 4); k < n; k++) { const it = cat[Math.floor(Math.random() * cat.length)], q = 1 + Math.floor(Math.random() * 3), co = it.cousin && Math.random() < .8; lignes.push({ id: uid(), article: it.nom, qte: q, prix: it.prix, montant: q * it.prix, notes: Math.random() < .2 ? 'tache au col' : '', cousin: co, cousinStatut: co ? (age > 5 ? 'revenu' : age > 1 ? 'chez_cousin' : 'a_envoyer') : null, sentAt: co && age > 1 ? t + 864e5 : null, backAt: co && age > 5 ? t + 4 * 864e5 : null }); }
    const tot = lignes.reduce((s, l) => s + l.montant, 0), r = Math.random(), pay = [];
    if (r < .6) pay.push({ id: uid(), montant: tot, mode: ['especes', 'mtn', 'moov'][i % 3], date: t, user: u }); else if (r < .85) pay.push({ id: uid(), montant: Math.round(tot / 200) * 100, mode: 'mtn', date: t, user: u });
    put('factures', { demo: true, numero: 'MP' + ymd(t).slice(2).replace(/-/g, '') + '-D' + String(i).padStart(2, '0'), code: String(1000 + i * 37), clientId: c.id, type: 'normale', createdAt: t, createdBy: u, lignes, express: false, promoId: null, remisePromo: 0, remiseManuelle: 0, majoration: 0, arriere: null, sousTotal: tot, total: tot, dateRetrait: ymd(t + 3 * 864e5), statut: age > 6 ? 'retire' : age > 3 ? 'pret' : age > 1 ? 'en_cours' : 'recu', paiements: pay, annulee: false });
  }
  put('factures', { demo: true, numero: 'MP-ARR-01', type: 'arriere', clientId: cs[1].id, createdAt: Date.now() - 40 * 864e5, createdBy: u, lignes: [], arriere: { montant: 7500, motif: 'Dette du cahier (2025)' }, sousTotal: 0, total: 7500, statut: 'retire', paiements: [], annulee: false, code: '' });
  put('promotions', { demo: true, nom: 'Mardi malin', type: 'pourcent', valeur: 15, jours: [2], articles: [], cible: 'tous', minimum: 0, actif: true, debut: '', fin: '', createdAt: Date.now() });
  toast('Données de démonstration chargées'); render();
};
ACT.demoOff = async () => { if (!await confirmBox('Supprimer toutes les données de démonstration ?')) return; COLLS.forEach(c => db[c].forEach(r => { if (r.demo && !r.deleted) { r.deleted = true; r.updatedAt = Date.now(); } })); persist(); toast('Données de démo supprimées'); render(); };

// Sauvegarde en ligne & IA
FORMS.cloud = v => { safeSet('cloud', { url: cloud.normalizeUrl(v.url), key: (v.key || '').trim(), password: v.password || '', enabled: !!v.enabled }); toast('Sauvegarde en ligne enregistrée'); render(); autoBackup(); };
ACT.cloudNow = async () => { const c = getCloud(); if (!c.url || !c.key || !c.password) return toast('Remplissez et enregistrez d\'abord l\'adresse, la clé et le mot de passe.'); toast('Envoi de la sauvegarde…'); try { const r = await backupNow(); toast('Sauvegarde envoyée (' + Math.round(r.size / 1024) + ' ko)'); } catch (e) { safeSet('cloudLast', { at: new Date().toISOString(), ok: false, error: e.message }); toast(e.message); } render(); };
ACT.cloudRestore = () => { const c = getCloud(); modal(`<h2>Restaurer depuis internet</h2><form data-form="cloudList"><label>Adresse du projet Supabase</label><input name="url" required value="${esc(c.url)}" placeholder="https://xxxx.supabase.co"><label>Clé publique</label><input name="key" required value="${esc(c.key)}"><label>Mot de passe de sauvegarde</label><input name="password" type="password" required value="${esc(c.password)}"><div class="row" style="margin-top:12px"><button class="btn p">Voir les sauvegardes</button><button type="button" class="btn" data-act="closeModal">Annuler</button></div></form><div id="cloudList" style="margin-top:10px"></div>`); };
FORMS.cloudList = async v => { const c = { ...getCloud(), url: cloud.normalizeUrl(v.url), key: v.key.trim(), password: v.password }, z = $('#cloudList'); z.innerHTML = '<p class="mut">Recherche…</p>'; try { const l = await cloud.listBackups(c); state.cloudTmp = c; z.innerHTML = l.length ? l.slice(0, 15).map(b => `<div class="lrow"><span>${dFR(b.date)} <span class="mut">${b.size ? Math.round(b.size / 1024) + ' ko' : ''}</span></span><button class="btn sm p" data-act="cloudPick" data-n="${esc(b.name)}">Restaurer</button></div>`).join('') : '<p class="mut">Aucune sauvegarde trouvée.</p>'; } catch (e) { z.innerHTML = `<p class="pill bad" style="white-space:normal">${esc(e.message)}</p>`; } };
ACT.cloudPick = async a => { const c = state.cloudTmp, name = a.dataset.n; if (!await confirmBox('Remplacer toutes les données de ce téléphone par la sauvegarde du ' + dFR(name.slice(11, 21)) + ' ?', 'Oui, restaurer', 'Annuler')) return; toast('Restauration…'); try { await importAll(await cloud.downloadBackup(c, name, c.password)); safeSet('cloud', { ...c, enabled: true }); toast('Données restaurées'); render(); } catch (e) { toast(e.message); } };
FORMS.iacfg = v => { setCfg({ iaKey: (v.iaKey || '').trim(), ia: !!v.ia }); toast('Réglage IA enregistré'); render(); };
ACT.iaTest = async () => { toast('Test de l\'IA…'); try { const r = await ai('assistant', { question: 'Réponds seulement : « L’IA fonctionne. »', donnees: {} }); toast(r.slice(0, 90)); } catch (e) { toast('IA : ' + e.message); } };

// ---------- Écouteurs globaux ----------
document.addEventListener('click', e => {
  const a = e.target.closest('[data-act]'); if (!a) return; const fn = ACT[a.dataset.act]; if (!fn) return;
  // Appel synchrone : les liens WhatsApp reçoivent leur adresse avant que le navigateur ne les suive
  try { const r = fn(a, e); if (r && r.catch) r.catch(err => toast('Erreur : ' + err.message)); } catch (err) { toast('Erreur : ' + err.message); }
  if (a.tagName === 'A' && (a.getAttribute('href') || '#') === '#') e.preventDefault();
});
document.addEventListener('submit', e => { const f = e.target; if (!f.dataset.form) return; e.preventDefault(); Promise.resolve(FORMS[f.dataset.form]?.(Object.fromEntries(new FormData(f)), f)).catch(err => toast('Erreur : ' + err.message)); });
document.addEventListener('input', e => {
  const t = e.target, d = state.draft;
  if (t.id === 'cq') { state.cq = t.value; renderCRes(); return; }
  if (t.id === 'qsearch') { state.q = t.value; $('#liste').innerHTML = listeCommandes(); return; }
  if (t.id === 'clq') { state.clq = t.value; $('#cliste').innerHTML = listeClients(); return; }
  if (!d) return;
  if (t.dataset.d) { setPath(d, t.dataset.d, t.type === 'number' ? (+t.value || 0) : t.value); if (t.dataset.d === 'dateRetrait') d.dateManuelle = true; refreshTotaux(); }
  else if (t.dataset.l !== undefined && t.dataset.k && t.dataset.k !== 'article') { const l = d.lignes[+t.dataset.l]; if (l) { l[t.dataset.k] = t.type === 'number' ? (+t.value || 0) : t.value; refreshTotaux(); } }
});
document.addEventListener('change', e => {
  const t = e.target, d = state.draft;
  if (t.dataset.actChange) { Promise.resolve(ACT_CHANGE[t.dataset.actChange]?.(t, e)).catch(err => toast('Erreur : ' + err.message)); return; }
  if (t.dataset.cfgchk) { setCfg({ [t.dataset.cfgchk]: t.checked }); render(); return; }
  if (t.dataset.cat !== undefined) { const c = db.settings.catalogue[+t.dataset.cat], k = t.dataset.ck; c[k] = t.type === 'checkbox' ? t.checked : t.type === 'number' ? (+t.value || 0) : t.value.trim(); saveSettings(); toast('Tarif enregistré'); return; }
  if (!d) return;
  if (t.dataset.k === 'article') { const l = d.lignes[+t.dataset.l]; l.article = t.value; l.prix = catItem(t.value)?.prix || 0; render(); }
  else if (t.dataset.dchk) { d[t.dataset.dchk] = t.checked; render(); }
  else if (t.dataset.lchk !== undefined) { d.lignes[+t.dataset.lchk].cousin = t.checked; render(); }
  else if (t.dataset.dsel) { d[t.dataset.dsel] = t.value || null; if (t.dataset.dsel === 'promoId') d.promoAuto = false; render(); }
});
window.addEventListener('hashchange', route);
window.addEventListener('online', () => { renderSyncBadge(); autoBackup(); });
window.addEventListener('offline', renderSyncBadge);

// ---------- Démarrage ----------
async function boot() {
  for (const k of ['user', 'cfg', 'cloud', 'cloudLast', 'cloudLastOk', 'lastExport']) KV[k] = await store.kv(k);
  db = loadDB(await store.kv(LS_DB));
  route();
  autoBackup(); setInterval(autoBackup, 15 * 60e3);
}
document.addEventListener('visibilitychange', () => { if (document.hidden) flush(); else autoBackup(); });
window.addEventListener('pagehide', flush);
boot();
