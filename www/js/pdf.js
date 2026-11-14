// Facture PDF (A4). jsPDF, sans internet.
import { orderTotals, money, fmtDate, numberToWords, STATUS_LABEL } from './logic.js';

const NAVY = [15, 45, 87], BLUE = [28, 95, 166], GREY = [100, 110, 125], LIGHT = [238, 243, 250];

function imgSize(dataUrl) {
  return new Promise((resolve) => {
    const i = new Image();
    i.onload = () => resolve({ w: i.width, h: i.height });
    i.onerror = () => resolve(null);
    i.src = dataUrl;
  });
}

// jsPDF n'aime pas les espaces fines insécables de toLocaleString.
const m = (n) => money(n).replace(/[  ]/g, ' ');

export async function invoicePdf(o, s) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const W = 210, L = 15, R = W - 15;
  const t = orderTotals(o);

  // En-tête : logo à gauche, code-barres à droite
  let y = 15, textX = L;
  if (s.logo) {
    const sz = await imgSize(s.logo);
    if (sz) {
      const h = 24, w = Math.min(40, (sz.w / sz.h) * h);
      const fmt = s.logo.startsWith('data:image/png') ? 'PNG' : 'JPEG';
      doc.addImage(s.logo, fmt, L, y, w, h);
      textX = L + w + 5;
    }
  }
  doc.setTextColor(...NAVY); doc.setFont('helvetica', 'bold'); doc.setFontSize(18);
  doc.text(s.name || 'Pressing', textX, y + 7);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(...GREY);
  const sub = [s.city, s.phone ? 'Tél. ' + s.phone : ''].filter(Boolean);
  sub.forEach((line, i) => doc.text(line, textX, y + 13 + i * 5));


  // Bandeau facture
  y = 46;
  doc.setFillColor(...BLUE); doc.roundedRect(L, y, R - L, 14, 2, 2, 'F');
  doc.setTextColor(255); doc.setFont('helvetica', 'bold'); doc.setFontSize(14);
  doc.text(`FACTURE N°${o.number}`, L + 5, y + 9.3);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
  doc.text(`Émise le ${fmtDate(o.createdAt)}`, R - 5, y + 9.3, { align: 'right' });

  // Client
  y += 22;
  doc.setTextColor(...GREY); doc.setFontSize(9); doc.text('CLIENT', L, y);
  doc.setTextColor(20); doc.setFontSize(12); doc.setFont('helvetica', 'bold');
  doc.text(o.clientName, L, y + 6);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
  if (o.clientPhone) doc.text('Tél. ' + o.clientPhone, L, y + 11);
  if (o.deliveryFee || o.deliveryPlace || o.deliveryAt) {
    doc.setTextColor(...GREY); doc.setFontSize(9); doc.text('LIVRAISON', 115, y);
    doc.setTextColor(20); doc.setFontSize(10);
    const lines = doc.splitTextToSize(o.deliveryPlace || 'À préciser', R - 115);
    doc.text(lines, 115, y + 6);
    if (o.deliveryAt) doc.text('Le ' + fmtDate(o.deliveryAt), 115, y + 6 + lines.length * 5);
  }

  // Tableau des articles
  y += 22;
  const cols = [L + 3, 120, 150, R - 3];
  doc.setFillColor(...LIGHT); doc.rect(L, y, R - L, 9, 'F');
  doc.setTextColor(...NAVY); doc.setFont('helvetica', 'bold'); doc.setFontSize(10);
  doc.text('Désignation', cols[0], y + 6);
  doc.text('Qté', cols[1], y + 6, { align: 'right' });
  doc.text('Prix unit.', cols[2], y + 6, { align: 'right' });
  doc.text('Montant', cols[3], y + 6, { align: 'right' });
  y += 9;
  doc.setFont('helvetica', 'normal'); doc.setTextColor(20);
  const rows = o.items.map((i) => [i.name, String(i.qty), m(i.price), m(i.qty * i.price)]);
  if (o.deliveryFee) rows.push(['Livraison', '1', m(o.deliveryFee), m(o.deliveryFee)]);
  if (t.discount) rows.push([(o.discount && o.discount.label) || 'Remise', '', '', '- ' + m(t.discount)]);
  for (const r of rows) {
    if (y > 250) { doc.addPage(); y = 20; }
    const name = doc.splitTextToSize(r[0], cols[1] - cols[0] - 15);
    const h = Math.max(8, name.length * 5 + 3);
    doc.text(name, cols[0], y + 5.5);
    doc.text(r[1], cols[1], y + 5.5, { align: 'right' });
    doc.text(r[2], cols[2], y + 5.5, { align: 'right' });
    doc.text(r[3], cols[3], y + 5.5, { align: 'right' });
    y += h;
    doc.setDrawColor(225); doc.line(L, y, R, y);
  }

  // Total
  y += 4;
  doc.setFillColor(...NAVY); doc.roundedRect(115, y, R - 115, 12, 2, 2, 'F');
  doc.setTextColor(255); doc.setFont('helvetica', 'bold'); doc.setFontSize(13);
  doc.text('TOTAL', 120, y + 8); doc.text(m(t.total), R - 4, y + 8, { align: 'right' });
  doc.setTextColor(20); doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
  doc.text(`${t.pieces} pièce(s)`, L, y + 8);
  y += 20;
  const words = numberToWords(t.total);
  doc.setFont('helvetica', 'italic');
  doc.text(doc.splitTextToSize(`Arrêtée la présente facture à la somme de ${words} (${m(t.total)}) francs CFA.`, R - L), L, y);
  doc.setFont('helvetica', 'bold'); y += 12;
  doc.setTextColor(...(t.due <= 0 ? [20, 133, 90] : [200, 90, 20]));
  doc.text(t.due <= 0 ? 'PAYÉE' : t.paid > 0 ? `ACOMPTE VERSÉ : ${m(t.paid)}  ·  RESTE À PAYER : ${m(t.due)}` : 'NON PAYÉE', L, y);
  const due = o.dueAt || o.deliveryAt;
  if (due) { doc.setFont('helvetica', 'normal'); doc.setTextColor(20); doc.text('À rendre le ' + fmtDate(due), L, y + 6); }

  // Pied de page
  doc.setTextColor(...GREY); doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
  doc.text('Présentez cette facture pour le retrait de votre linge.', W / 2, 280, { align: 'center' });
  doc.text('Merci de votre confiance !', W / 2, 285, { align: 'center' });
  return doc.output('blob');
}

// Ticket de caisse 58 mm (zone imprimable ~48 mm) pour imprimante thermique Bluetooth.
export async function ticketPdf(o, s) {
  const { jsPDF } = window.jspdf;
  const t = orderTotals(o);
  const W = 58, X = 4, RX = W - 4;
  // hauteur calculée d'après le contenu
  const lines = o.items.length + (o.deliveryFee ? 1 : 0) + (t.discount ? 1 : 0);
  const H = 92 + lines * 8 + (t.paid > 0 && t.due > 0 ? 10 : 0) + (s.logo ? 20 : 0);
  const doc = new jsPDF({ unit: 'mm', format: [W, H] });
  let y = 5;
  if (s.logo) {
    const sz = await imgSize(s.logo);
    if (sz) { const h = 16, w = Math.min(44, (sz.w / sz.h) * h); doc.addImage(s.logo, s.logo.startsWith('data:image/png') ? 'PNG' : 'JPEG', (W - w) / 2, y, w, h); y += h + 3; }
  }
  const center = (txt, size = 8, bold = false) => { doc.setFont('helvetica', bold ? 'bold' : 'normal'); doc.setFontSize(size); doc.text(txt, W / 2, y, { align: 'center' }); y += size * 0.45 + 1.2; };
  const dash = () => { doc.setLineDashPattern([0.8, 0.8], 0); doc.setDrawColor(0); doc.line(X, y, RX, y); doc.setLineDashPattern([], 0); y += 3.5; };
  const lr = (a, b, size = 8, bold = false) => { doc.setFont('helvetica', bold ? 'bold' : 'normal'); doc.setFontSize(size); const la = doc.splitTextToSize(a, 30); doc.text(la, X, y); doc.text(b, RX, y, { align: 'right' }); y += la.length * size * 0.42 + 1.6; };
  doc.setTextColor(0);
  center(s.name || 'Pressing', 11, true);
  if (s.city) center(s.city, 7.5);
  if (s.phone) center('Tél. ' + s.phone, 7.5);
  y += 1; dash();
  center(`FACTURE N°${o.number}`, 10, true);
  center(fmtDate(o.createdAt), 7.5);
  y += 1;
  lr('Client', o.clientName, 8, true);
  if (o.clientPhone) lr('Tél.', o.clientPhone, 7.5);
  dash();
  for (const i of o.items) lr(`${i.qty} x ${i.name}`, m(i.qty * i.price));
  if (o.deliveryFee) lr('Livraison', m(o.deliveryFee));
  if (t.discount) lr('Remise', '- ' + m(t.discount));
  dash();
  lr('TOTAL', m(t.total), 11, true);
  if (t.paid > 0 && t.due > 0) { lr('Payé', m(t.paid)); lr('RESTE À PAYER', m(t.due), 9, true); }
  else lr(t.due <= 0 ? 'Payée' : 'Non payée', '', 8, true);
  lr(`${t.pieces} pièce(s)`, '', 7.5);
  const due = o.dueAt || o.deliveryAt;
  if (due) lr('À rendre le', fmtDate(due), 7.5);
  dash();
  center('Merci de votre confiance !', 8, true);
  center('Présentez ce ticket au retrait.', 7);
  return doc.output('blob');
}

export function statusText(o) { return STATUS_LABEL[o.status]; }
