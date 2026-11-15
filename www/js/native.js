// Pont entre l'appli Android (Capacitor) et le navigateur : partage de fichiers, liens externes.
const Cap = window.Capacitor;
export const isNative = !!(Cap && Cap.isNativePlatform && Cap.isNativePlatform());
function plugin(name) {
  try { return Cap.registerPlugin ? Cap.registerPlugin(name) : (Cap.Plugins && Cap.Plugins[name]); }
  catch (e) { return Cap.Plugins && Cap.Plugins[name]; }
}
const Filesystem = isNative ? plugin('Filesystem') : null;
const Share = isNative ? plugin('Share') : null;

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1]);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

// Ouvre le menu de partage du téléphone (WhatsApp, Drive…) avec le fichier.
// Renvoie 'shared' | 'downloaded' | 'cancelled'.
export async function shareFile(blob, filename, title = '') {
  if (isNative) {
    const data = await blobToBase64(blob);
    const res = await Filesystem.writeFile({ path: filename, data, directory: 'CACHE' });
    try {
      await Share.share({ title, dialogTitle: title || 'Partager', files: [res.uri] });
      return 'shared';
    } catch (e) {
      if (/cancel/i.test(String(e && e.message))) return 'cancelled';
      throw e;
    }
  }
  const file = new File([blob], filename, { type: blob.type });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title }); return 'shared'; }
    catch (e) { if (e.name === 'AbortError') return 'cancelled'; }
  }
  download(blob, filename);
  return 'downloaded';
}

// Enregistre le fichier dans le dossier Documents du téléphone (ou téléchargement dans le navigateur).
export async function saveFile(blob, filename, { folder = 'SmartPressing', silent = false } = {}) {
  if (isNative) {
    const data = await blobToBase64(blob);
    try {
      await Filesystem.writeFile({ path: folder + '/' + filename, data, directory: 'DOCUMENTS', recursive: true });
      return 'Documents/' + folder + '/' + filename;
    } catch (e) {
      if (silent) return null;
      await shareFile(blob, filename, filename);
      return null;
    }
  }
  if (silent) return null;
  download(blob, filename);
  return filename;
}

export function openExternal(url) {
  if (isNative) { window.location.href = url; return; }
  window.open(url, '_blank');
}

// Numéro au format international pour WhatsApp (Bénin : +229 par défaut).
export function waNumber(phone) {
  let d = String(phone || '').replace(/\D/g, '');
  if (!d) return '';
  if (d.startsWith('00')) d = d.slice(2);
  if (!d.startsWith('229') || d.length <= 10) d = '229' + d;
  return d;
}

// Rappel le 1er de chaque mois à 9 h (Android : notification même appli fermée).
const Notif = isNative ? plugin('LocalNotifications') : null;
export async function scheduleMonthlyReminder(on) {
  if (!Notif) return false;
  try {
    await Notif.cancel({ notifications: [{ id: 101 }] });
    if (!on) return true;
    let perm = await Notif.checkPermissions();
    if (perm.display !== 'granted') perm = await Notif.requestPermissions();
    if (perm.display !== 'granted') return false;
    await Notif.schedule({ notifications: [{
      id: 101, title: 'Smart Pressing', body: 'Le bilan du mois dernier est prêt : ouvrez l’appli pour l’envoyer.',
      schedule: { on: { day: 1, hour: 9, minute: 0 }, repeats: true, allowWhileIdle: true },
    }] });
    return true;
  } catch (e) { console.warn('rappel', e); return false; }
}

// ---------- WhatsApp (Business de préférence) ----------
const Wa = isNative ? plugin('WaLauncher') : null;
const PKG = { business: 'com.whatsapp.w4b', normal: 'com.whatsapp' };
function pkgOrder(s) { return s && s.waApp === 'normal' ? [PKG.normal, PKG.business] : [PKG.business, PKG.normal]; }

// Ouvre la conversation du client avec le texte prêt à envoyer.
export async function waOpen(phone, text, s) {
  const num = waNumber(phone);
  if (Wa) {
    for (const pkg of pkgOrder(s)) {
      try { await Wa.open({ phone: num, text, package: pkg }); return 'app'; } catch (e) {}
    }
  }
  openExternal(`https://wa.me/${num}?text=${encodeURIComponent(text)}`);
  return 'link';
}

// Envoie une image (carte) + texte dans la conversation du client.
export async function waSendImage(blob, filename, phone, text, s) {
  const num = waNumber(phone);
  if (Wa) {
    const data = await blobToBase64(blob);
    const res = await Filesystem.writeFile({ path: filename, data, directory: 'CACHE' });
    for (const pkg of pkgOrder(s)) {
      try { await Wa.sendImage({ phone: num, text, package: pkg, path: res.uri }); return 'app'; } catch (e) {}
    }
    try { await Share.share({ text, files: [res.uri], dialogTitle: 'Envoyer la carte' }); return 'share'; } catch (e) { return 'cancelled'; }
  }
  const file = new File([blob], filename, { type: blob.type });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], text }); return 'share'; } catch (e) { if (e.name === 'AbortError') return 'cancelled'; }
  }
  download(blob, filename);
  openExternal(`https://wa.me/${num}?text=${encodeURIComponent(text)}`);
  return 'link';
}
