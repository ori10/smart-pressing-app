// Sauvegarde automatique en ligne (Supabase Storage, bucket « saves »), chiffrée avec un mot de passe (AES-GCM).
// Même principe que Smart Pressing : un fichier par jour, monpressing/sauvegarde-AAAA-MM-JJ.json.
const PREFIX = 'monpressing';
export const BUCKET = 'saves';

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
  if (box.app !== 'monpressing-cloud') throw new Error('Fichier de sauvegarde inconnu.');
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
  const k = String(c.key || '').trim();
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

// Envoie la sauvegarde du jour (remplacée si on renvoie le même jour).
export async function uploadBackup(c, data, day) {
  if (!c.url || !c.key || !c.password) throw new Error('Sauvegarde en ligne non configurée.');
  const body = await encrypt(data, c.password);
  const res = await fetch(`${base(c)}/storage/v1/object/${BUCKET}/${PREFIX}/sauvegarde-${day}.json`, {
    method: 'POST', headers: headers(c, { 'Content-Type': 'application/json', 'x-upsert': 'true' }), body,
  });
  await check(res, 'Envoi');
  return body.length;
}

export async function listBackups(c) {
  const res = await fetch(`${base(c)}/storage/v1/object/list/${BUCKET}`, {
    method: 'POST', headers: headers(c, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ prefix: PREFIX, limit: 100, offset: 0, sortBy: { column: 'name', order: 'desc' } }),
  });
  await check(res, 'Lecture');
  return (await res.json()).filter((f) => /^sauvegarde-\d{4}-\d{2}-\d{2}\.json$/.test(f.name))
    .map((f) => ({ name: f.name, date: f.name.slice(11, 21), size: f.metadata && f.metadata.size }))
    .sort((a, b) => b.name.localeCompare(a.name));
}

export async function downloadBackup(c, name, password) {
  const res = await fetch(`${base(c)}/storage/v1/object/${BUCKET}/${PREFIX}/${name}`, { headers: headers(c) });
  await check(res, 'Téléchargement');
  return decrypt(await res.text(), password);
}
