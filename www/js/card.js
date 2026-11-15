// Carte de remerciement (image 1080 × 1350) envoyée après la livraison.
function loadImg(src) {
  return new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = src; });
}
function wrap(ctx, text, maxW) {
  const words = text.split(' '); const lines = []; let line = '';
  for (const w of words) { const t = line ? line + ' ' + w : w; if (ctx.measureText(t).width > maxW && line) { lines.push(line); line = w; } else line = t; }
  if (line) lines.push(line);
  return lines;
}
export async function thanksCard({ s, civ, name, renewed }) {
  try { await Promise.all([document.fonts.load('800 80px PJS'), document.fonts.load('600 40px PJS')]); } catch (e) {}
  const W = 1080, H = 1350, c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d');
  x.fillStyle = '#ffffff'; x.fillRect(0, 0, W, H);
  // bandeaux de couleur
  x.fillStyle = '#0f2d57'; x.fillRect(0, H - 150, W, 150);
  x.fillStyle = '#f08a24'; x.fillRect(0, H - 162, W, 12);
  let y = 70;
  const logo = s.logo ? await loadImg(s.logo) : null;
  if (logo) { const h = 300, w = Math.min(560, logo.width * h / logo.height); x.drawImage(logo, (W - w) / 2, y, w, h); y += h + 40; }
  else { x.fillStyle = '#0f2d57'; x.font = '800 70px PJS, sans-serif'; x.textAlign = 'center'; x.fillText(s.name || 'Smart Pressing', W / 2, y + 80); y += 160; }
  x.textAlign = 'center';
  x.fillStyle = '#f08a24'; x.font = '800 130px PJS, sans-serif'; x.fillText('Merci !', W / 2, y + 110); y += 190;
  x.fillStyle = '#0f2d57'; x.font = '700 52px PJS, sans-serif'; x.fillText(`${civ} ${name}`, W / 2, y); y += 90;
  x.fillStyle = '#14202e'; x.font = '600 44px PJS, sans-serif';
  const msg = `Toute l'équipe ${s.name || 'Smart Pressing'} vous remercie pour votre confiance${renewed ? ' encore renouvelée' : ''}.`;
  for (const l of wrap(x, msg, W - 180)) { x.fillText(l, W / 2, y); y += 62; }
  y += 30; x.fillStyle = '#667385'; x.font = '600 40px PJS, sans-serif';
  for (const l of wrap(x, 'Vos suggestions et critiques sont les bienvenues.', W - 200)) { x.fillText(l, W / 2, y); y += 56; }
  x.fillStyle = '#ffffff'; x.font = '700 42px PJS, sans-serif';
  const phone = s.waBusinessPhone || s.phone;
  x.fillText(phone ? `WhatsApp : ${phone.replace(/(\d{2})(?=\d)/g, '$1 ')}` : (s.city || ''), W / 2, H - 62);
  return new Promise((res) => c.toBlob(res, 'image/png'));
}
