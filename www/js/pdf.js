// Facture PDF (A4) et planche d'étiquettes. jsPDF + JsBarcode, sans internet.
import { orderCode, pieceCode, orderTotals, money, fmtDate, numberToWords, STATUS_LABEL } from './logic.js';

const NAVY = [15, 45, 87], BLUE = [28, 95, 166], GREY = [100, 110, 125], LIGHT = [238, 243, 250];

function barcodePng(text, { height = 60, width = 2, displayValue = true, fontSize = 18 } = {}) {
  const c = document.createElement('canvas');
  window.JsBarcode(c, text, { format: 'CODE128', height, width, displayValue, fontSize, margin: 6, font: 'monospace' });
  return { data: c.toDataURL('image/png'), w: c.width, h: c.height };
}

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

  const bc = barcodePng(orderCode(o.number), { height: 50, width: 2, fontSize: 16 });
  const bw = 55, bh = (bc.h / bc.w) * bw;
  doc.addImage(bc.data, 'PNG', R - bw, y - 2, bw, bh);

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
  doc.setTextColor(...(o.paid ? [20, 133, 90] : [200, 90, 20]));
  doc.text(o.paid ? 'PAYÉE' : 'NON PAYÉE', L, y);

  // Pied de page
  doc.setTextColor(...GREY); doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
  doc.text('Chaque pièce porte une étiquette ' + orderCode(o.number) + '-xx. Présentez cette facture pour le retrait.', W / 2, 280, { align: 'center' });
  doc.text('Merci de votre confiance !', W / 2, 285, { align: 'center' });
  return doc.output('blob');
}

// Planche d'étiquettes : 3 colonnes × 8 lignes par page A4.
export function labelsPdf(o, s) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const cols = 3, rows = 8, mx = 8, my = 10;
  const cw = (210 - 2 * mx) / cols, ch = (297 - 2 * my) / rows;
  o.pieces.forEach((p, i) => {
    const k = i % (cols * rows);
    if (i > 0 && k === 0) doc.addPage();
    const x = mx + (k % cols) * cw, y = my + Math.floor(k / cols) * ch;
    doc.setDrawColor(200); doc.setLineDashPattern([1, 1], 0); doc.rect(x + 1, y + 1, cw - 2, ch - 2);
    doc.setLineDashPattern([], 0);
    const code = pieceCode(o.number, p.index);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(...NAVY);
    doc.text((s.name || '').slice(0, 26), x + 4, y + 5.5);
    doc.setTextColor(20); doc.setFont('helvetica', 'normal');
    doc.text(`N°${o.number} · ${p.index}/${o.pieces.length}`, x + cw - 4, y + 5.5, { align: 'right' });
    const bc = barcodePng(code, { height: 40, width: 2, fontSize: 16 });
    const bw = cw - 10, bh = Math.min(ch - 16, (bc.h / bc.w) * bw);
    doc.addImage(bc.data, 'PNG', x + 5, y + 7, bw, bh);
    doc.setFontSize(8);
    const label = `${p.name}${p.homeWash ? ' (maison)' : ''} · ${o.clientName}`;
    doc.text(doc.splitTextToSize(label, cw - 8)[0], x + cw / 2, y + ch - 3.5, { align: 'center' });
  });
  return doc.output('blob');
}

export function statusText(o) { return STATUS_LABEL[o.status]; }
