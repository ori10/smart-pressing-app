// Sauvegarde automatique en ligne (Supabase Storage), chiffrée avec un mot de passe (AES-GCM).
import { db } from './db.js';
import { exportAll, importAll, nowIso, todayIso } from './logic.js';

const PREFIX = 'monpressing';
export const BUCKET = 'saves';

export async function getCloud() { return (await db.kv('cloud')) || { enabled: false, url: '', key: '', password: '' }; }
export async function setCloud(c) { await db.kv('cloud', c); }

// ---------- chiffrement ----------
const enc = new TextEncoder(), dec = new TextDecoder();
const b64 = (buf) => { let s = ''; const a = new Uint8Array(buf); for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode.apply(null, a.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
async function keyFrom(password, salt) {
  const base = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 150000, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
export async function encrypt(obj, password) {
  const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await keyFrom(password, salt), enc.encode(JSON.stringify(obj)));
  return JSON.stringify({ app: 'monpressing-cloud', v: 1, salt: b64(salt), iv: b64(iv), data: b64(data) });
}
export async function decrypt(text, password) {
  const box = JSON.parse(text);
  if (!['monpressing-cloud', 'smart-pressing-cloud'].includes(box.app)) throw new Error('Fichier de sauvegarde inconnu.');
  try {
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(box.iv) }, await keyFrom(password, unb64(box.salt)), unb64(box.data));
    return JSON.parse(dec.decode(plain));
  } catch (e) { throw new Error('Mot de passe de sauvegarde incorrect.'); }
}

// ---------- stockage ----------
// Accepte l'adresse sous toutes ses formes et garde seulement https://xxxx.supabase.co
export function normalizeUrl(raw) {
  let u = String(raw || '').trim().replace(/\s+/g, '');
  if (!u) return '';
  const dash = u.match(/supabase\.com\/dashboard\/project\/([a-z0-9]+)/i);
  if (dash) return `https://${dash[1].toLowerCase()}.supabase.co`;
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
  try { return new URL(u).origin; } catch (e) { return u.replace(/\/+$/, ''); }
}
function base(c) { return normalizeUrl(c.url); }
// Ancienne clé « anon » (JWT, commence par eyJ) : aussi en Authorization. Nouvelle clé « sb_publishable_… » : apikey seul.
function headers(c, extra = {}) {
  const k = c.key.trim();
  return { ...(k.startsWith('eyJ') ? { Authorization: 'Bearer ' + k } : {}), apikey: k, ...extra };
}
export const SETUP_SQL = `insert into storage.buckets (id, name, public) values ('saves', 'saves', false) on conflict (id) do nothing;
create policy "monpressing_ajout" on storage.objects for insert to anon with check (bucket_id = 'saves' and (storage.foldername(name))[1] = 'monpressing');
create policy "monpressing_maj" on storage.objects for update to anon using (bucket_id = 'saves' and (storage.foldername(name))[1] = 'monpressing');
create policy "monpressing_lecture" on storage.objects for select to anon using (bucket_id = 'saves' and (storage.foldername(name))[1] = 'monpressing');`;
async function check(res, what) {
  if (res.ok) return res;
  let msg = '';
  try { const t = await res.text(); try { const j = JSON.parse(t); msg = j.message || j.error || j.msg || t; } catch (e) { msg = t; } } catch (e) {}
  msg = String(msg).slice(0, 120);
  if (/bucket/i.test(msg)) throw new Error(`Le dossier « ${BUCKET} » est introuvable dans Supabase : vérifiez son nom dans Storage (tout en minuscules : ${BUCKET}).`);
  if (res.status === 404) throw new Error(`Adresse du projet incorrecte (404). Elle doit ressembler à https://xxxx.supabase.co — ${msg}`);
  if (res.status === 400 || res.status === 403 || res.status === 401) throw new Error(`${what} refusé par le serveur (${msg || res.status}). Vérifiez la clé et les règles d’accès.`);
  throw new Error(`${what} impossible (${res.status} ${msg})`);
}
async function upload(c, path, body) {
  const res = await fetch(`${base(c)}/storage/v1/object/${BUCKET}/${path}`, {
    method: 'POST', headers: headers(c, { 'Content-Type': 'application/json', 'x-upsert': 'true' }), body,
  });
  await check(res, 'Envoi');
}
export async function listBackups(c) {
  const res = await fetch(`${base(c)}/storage/v1/object/list/${BUCKET}`, {
    method: 'POST', headers: headers(c, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ prefix: PREFIX, limit: 100, offset: 0, sortBy: { column: 'name', order: 'desc' } }),
  });
  await check(res, 'Lecture');
  return (await res.json()).filter((f) => /^sauvegarde-\d{4}-\d{2}-\d{2}\.json$/.test(f.name)).map((f) => ({ name: f.name, date: f.name.slice(11, 21), size: f.metadata && f.metadata.size }))
    .sort((a, b) => b.name.localeCompare(a.name));
}
async function download(c, name) {
  const res = await fetch(`${base(c)}/storage/v1/object/${BUCKET}/${PREFIX}/${name}`, { headers: headers(c) });
  await check(res, 'Téléchargement');
  return res.text();
}

// Envoie la sauvegarde du jour (un fichier par jour, remplacé si on renvoie le même jour).
export async function backupNow(c) {
  c = c || (await getCloud());
  if (!c.url || !c.key || !c.password) throw new Error('Sauvegarde en ligne non configurée.');
  const body = await encrypt(await exportAll(), c.password);
  await upload(c, `${PREFIX}/sauvegarde-${todayIso()}.json`, body);
  const at = nowIso();
  await db.kv('cloudLast', { at, ok: true, size: body.length });
  await db.kv('cloudLastOk', at);
  await db.kv('lastBackup', at);
  return { at, size: body.length };
}

export async function restoreFromCloud(c, name, password) {
  const data = await decrypt(await download(c, name), password);
  await importAll(data);
  return data;
}

// Automatique : chaque soir à partir de 19 h (ou dès l'ouverture si la dernière a plus de 36 h).
let running = false;
export async function autoBackup(onDone) {
  if (running || !navigator.onLine) return;
  const c = await getCloud();
  if (!c.enabled || !c.url || !c.key || !c.password) return;
  const last = (await db.kv('cloudLast')) || {};
  const lastOk = (await db.kv('cloudLastOk')) || '';
  const now = new Date();
  const hoursSince = lastOk ? (Date.now() - new Date(lastOk).getTime()) / 3600e3 : 1e9;
  const doneToday = lastOk && lastOk.slice(0, 10) === todayIso();
  const due = (now.getHours() >= 19 && !doneToday) || hoursSince > 36;
  if (!due) return;
  if (last.ok === false && last.at && (Date.now() - new Date(last.at).getTime()) < 30 * 60e3) return; // pas d'acharnement
  running = true;
  try {
    const r = await backupNow(c);
    await db.kv('cloudLastOk', r.at);
    onDone && onDone(true);
  } catch (e) {
    await db.kv('cloudLast', { at: nowIso(), ok: false, error: e.message });
    onDone && onDone(false, e);
  } finally { running = false; }
}
