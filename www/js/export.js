// Export du bilan : PDF (jsPDF) et Excel (SheetJS). Période au choix : mois, 6 mois, année.
import { money, kg, fmtDate, nowIso, orderTotals, catLabel, catInvest, monthsBetween, daysBetween, monthName, monthShort as mShort, STATUS_LABEL } from './logic.js';

const NAVY = [15, 45, 87], BLUE = [28, 95, 166], ORANGE = [240, 138, 36], PURPLE = [122, 79, 184], GREY = [100, 110, 125], LIGHT = [238, 243, 250];
const m = (n) => money(n).replace(/[  ]/g, ' ');
const monthShort = (ym) => mShort(Number(ym.slice(5)) - 1);

function rowsByPeriod(b, p) {
  if (p.kind === 'month') {
    return daysBetween(p.start, p.end).map((d) => ({ label: d.slice(8) + '/' + d.slice(5, 7), ca: b.byDay[d] || 0 }));
  }
  return monthsBetween(p.start, p.end).map((ym) => {
    const r = b.byMonth[ym] || { ca: 0, wash: 0, exp: 0, inv: 0 };
    return { label: monthName(Number(ym.slice(5)) - 1) + ' ' + ym.slice(0, 4), short: monthShort(ym), ...r, net: r.ca - r.wash - r.exp };
  });
}

export function bilanFileName(p, ext) {
  const tag = p.kind === 'month' ? p.start.slice(0, 7) : p.kind === 'year' ? p.start.slice(0, 4) : `${p.start.slice(0, 7)}_${p.end.slice(0, 7)}`;
  return `Bilan-${tag}.${ext}`;
}

// ------------------------------------------------------------------ PDF
export function bilanPdf(b, p, S) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const W = 210, L = 15, R = W - 15;
  let y = 15;
  const newPageIfNeeded = (h) => { if (y + h > 280) { doc.addPage(); y = 18; } };

  if (S.logo) { try { doc.addImage(S.logo, S.logo.startsWith('data:image/png') ? 'PNG' : 'JPEG', L, y, 18, 18); } catch (e) {} }
  const tx = S.logo ? L + 22 : L;
  doc.setTextColor(...NAVY); doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.text(S.name || 'Pressing', tx, y + 7);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(...GREY);
  doc.text([S.city, S.phone].filter(Boolean).join(' · '), tx, y + 12.5);
  doc.text('Édité le ' + fmtDate(nowIso()), R, y + 7, { align: 'right' });
  y += 24;
  doc.setFillColor(...BLUE); doc.roundedRect(L, y, R - L, 13, 2, 2, 'F');
  doc.setTextColor(255); doc.setFont('helvetica', 'bold'); doc.setFontSize(14);
  doc.text('BILAN · ' + p.label.replace('–', '-'), L + 5, y + 8.7);
  y += 19;

  // Indicateurs
  const kpis = [["Chiffre d'affaires", m(b.ca)], ['Encaissé', m(b.cashed)], ['Impayés', m(b.unpaid)], ['Bénéfice net', m(b.net)]];
  const kw = (R - L - 9) / 4;
  kpis.forEach(([t, v], i) => {
    const x = L + i * (kw + 3);
    doc.setFillColor(...LIGHT); doc.roundedRect(x, y, kw, 17, 2, 2, 'F');
    doc.setTextColor(...GREY); doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.text(t, x + 3, y + 5.5);
    doc.setTextColor(...(i === 3 && b.net < 0 ? [192, 57, 43] : NAVY)); doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.text(v, x + 3, y + 13);
  });
  y += 24;

  // Compte de résultat
  const lines = [
    [`Chiffre d'affaires (${b.orders} commandes)`, m(b.ca), ''],
    [`- Lavage chez le cousin (${kg(b.washKg).replace(/ | /g, ' ')})`, '- ' + m(b.wash), ''],
    ['= Marge après lavage', m(b.margin), 'b'],
    ['- Dépenses courantes', '- ' + m(b.current), ''],
    ['= BÉNÉFICE NET', m(b.net), 'B'],
    ['- Investissements (machine, fer...)', '- ' + m(b.invest), ''],
    ['= Net après investissements', m(b.netAfterInvest), 'b'],
    [`À mettre de côté (${S.savingsPercent} % de la marge)`, m(b.savings), ''],
  ];
  doc.setTextColor(...NAVY); doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.text('Compte de résultat', L, y); y += 3;
  for (const [a, v, st] of lines) {
    if (st === 'B') { doc.setFillColor(227, 244, 236); doc.rect(L, y, R - L, 8, 'F'); }
    doc.setTextColor(20); doc.setFont('helvetica', st ? 'bold' : 'normal'); doc.setFontSize(st === 'B' ? 11 : 10);
    doc.text(a, L + 2, y + 5.5); doc.text(v, R - 2, y + 5.5, { align: 'right' });
    y += 8; doc.setDrawColor(225); doc.line(L, y, R, y);
  }
  if (b.washRatio > 0.35) {
    y += 3; doc.setTextColor(192, 57, 43); doc.setFontSize(9); doc.setFont('helvetica', 'bold');
    doc.text(`Attention : le lavage représente ${Math.round(b.washRatio * 100)} % du CA (alerte au-dessus de 35 %).`, L, y + 3); y += 4;
  }
  y += 8;

  // Graphique
  const rows = rowsByPeriod(b, p);
  newPageIfNeeded(70);
  doc.setTextColor(...NAVY); doc.setFont('helvetica', 'bold'); doc.setFontSize(11);
  doc.text(p.kind === 'month' ? "Chiffre d'affaires par jour" : "Chiffre d'affaires, lavage et dépenses par mois", L, y); y += 4;
  const ch = 48, cx = L + 14, cw = R - cx, base = y + ch;
  const series = p.kind === 'month' ? [['ca', BLUE]] : [['ca', BLUE], ['wash', ORANGE], ['exp', PURPLE]];
  const maxV = Math.max(1, ...rows.flatMap((r) => series.map(([k]) => (k === 'exp' ? (r.exp || 0) + (r.inv || 0) : r[k] || 0))));
  doc.setDrawColor(230); doc.setFontSize(7); doc.setFont('helvetica', 'normal'); doc.setTextColor(...GREY);
  [0, 0.5, 1].forEach((f) => { const yy = base - ch * f; doc.line(cx, yy, R, yy); doc.text(Math.round(maxV * f).toLocaleString('fr-FR').replace(/ | /g, ' '), cx - 2, yy + 1, { align: 'right' }); });
  const slot = cw / rows.length, gw = slot * 0.66, bw = gw / series.length;
  rows.forEach((r, i) => {
    series.forEach(([k, col], j) => {
      const v = k === 'exp' ? (r.exp || 0) + (r.inv || 0) : r[k] || 0;
      const h = (v / maxV) * ch;
      if (h > 0.2) { doc.setFillColor(...col); doc.rect(cx + slot * i + (slot - gw) / 2 + j * bw, base - h, Math.max(0.6, bw - 0.4), h, 'F'); }
    });
    const every = p.kind === 'month' ? 3 : 1;
    if (i % every === 0) { doc.setTextColor(...GREY); doc.text(p.kind === 'month' ? r.label.slice(0, 2) : r.short, cx + slot * i + slot / 2, base + 4, { align: 'center' }); }
  });
  y = base + 8;
  if (series.length > 1) {
    [["Chiffre d'affaires", BLUE], ['Lavage cousin', ORANGE], ['Dépenses + investissements', PURPLE]].forEach(([t, col], i) => {
      doc.setFillColor(...col); doc.rect(L + i * 55, y - 2.5, 3, 3, 'F'); doc.setTextColor(60); doc.text(t, L + i * 55 + 5, y);
    });
    y += 6;
  }
  y += 4;

  // Tableau détaillé
  const table = (title, head, body, aligns) => {
    newPageIfNeeded(20);
    doc.setTextColor(...NAVY); doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.text(title, L, y); y += 3;
    const colW = (R - L) / head.length;
    const drawHead = () => {
      doc.setFillColor(...LIGHT); doc.rect(L, y, R - L, 7, 'F');
      doc.setTextColor(...NAVY); doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5);
      head.forEach((h, i) => doc.text(h, aligns[i] === 'r' ? L + colW * (i + 1) - 2 : L + colW * i + 2, y + 4.8, { align: aligns[i] === 'r' ? 'right' : 'left' }));
      y += 7;
    };
    drawHead();
    doc.setFont('helvetica', 'normal'); doc.setTextColor(20);
    for (const row of body) {
      if (y > 278) { doc.addPage(); y = 18; drawHead(); doc.setFont('helvetica', 'normal'); doc.setTextColor(20); }
      doc.setFont('helvetica', row.bold ? 'bold' : 'normal');
      row.cells.forEach((c, i) => {
        const t = doc.splitTextToSize(String(c), colW - 3)[0];
        doc.text(t, aligns[i] === 'r' ? L + colW * (i + 1) - 2 : L + colW * i + 2, y + 4.8, { align: aligns[i] === 'r' ? 'right' : 'left' });
      });
      y += 6.5; doc.setDrawColor(235); doc.line(L, y, R, y);
    }
    y += 7;
  };

  if (p.kind !== 'month') {
    const tot = rows.reduce((a, r) => ({ ca: a.ca + r.ca, wash: a.wash + r.wash, exp: a.exp + r.exp, inv: a.inv + r.inv }), { ca: 0, wash: 0, exp: 0, inv: 0 });
    table('Détail par mois', ['Mois', 'CA', 'Lavage', 'Dépenses', 'Bénéfice net', 'Investiss.'],
      [...rows.map((r) => ({ cells: [r.label, m(r.ca), m(r.wash), m(r.exp), m(r.net), m(r.inv)] })),
        { bold: true, cells: ['Total', m(tot.ca), m(tot.wash), m(tot.exp), m(tot.ca - tot.wash - tot.exp), m(tot.inv)] }],
      ['l', 'r', 'r', 'r', 'r', 'r']);
  }
  const cats = Object.entries(b.expByCat).sort((a, c) => c[1] - a[1]);
  if (cats.length) table('Dépenses par catégorie', ['Catégorie', 'Type', 'Montant'], cats.map(([k, v]) => ({ cells: [catLabel(k), catInvest(k) ? 'Investissement' : 'Courante', m(v)] })), ['l', 'l', 'r']);
  if (b.topArticles.length) table('Articles les plus lavés', ['Article', 'Pièces'], b.topArticles.map(([n, c]) => ({ cells: [n, c] })), ['l', 'r']);
  if (b.orderList.length) table(`Factures de la période (${b.orderList.length})`, ['N°', 'Date', 'Client', 'Statut', 'Total', 'Reste dû'],
    b.orderList.map((o) => { const t = orderTotals(o); return { cells: [o.number, fmtDate(o.createdAt, false), o.clientName, STATUS_LABEL[o.status], m(t.total), t.due ? m(t.due) : '-'] }; }), ['l', 'l', 'l', 'l', 'r', 'r']);
  if (b.expenseList.length) table(`Dépenses de la période (${b.expenseList.length})`, ['Date', 'Catégorie', 'Détail', 'Montant'],
    b.expenseList.map((e) => ({ cells: [fmtDate(e.date, false), catLabel(e.category), e.label || '', m(e.amount)] })), ['l', 'l', 'l', 'r']);

  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i); doc.setFontSize(8); doc.setTextColor(...GREY); doc.setFont('helvetica', 'normal');
    doc.text(`${S.name || ''} · Bilan ${p.label.replace('–', '-')} · page ${i}/${pages}`, W / 2, 290, { align: 'center' });
  }
  return doc.output('blob');
}

// ------------------------------------------------------------------ Excel
export function bilanXlsx(b, p, S) {
  const X = window.XLSX;
  const wb = X.utils.book_new();
  const money = '#,##0" F"';
  const sheet = (rows, widths, moneyCols = [], startRow = 1) => {
    const ws = X.utils.aoa_to_sheet(rows);
    ws['!cols'] = widths.map((w) => ({ wch: w }));
    const range = X.utils.decode_range(ws['!ref']);
    for (let r = startRow; r <= range.e.r; r++) for (const c of moneyCols) {
      const cell = ws[X.utils.encode_cell({ r, c })];
      if (cell && typeof cell.v === 'number') cell.z = money;
    }
    return ws;
  };

  const resume = [
    [`${S.name || 'Pressing'} : bilan ${p.label}`, ''],
    [`Du ${fmtDate(p.start, false)} au ${fmtDate(p.end, false)}`, ''],
    [],
    ['Poste', 'Montant (F)'],
    ["Chiffre d'affaires", b.ca],
    ['Nombre de commandes', b.orders],
    ['Encaissé', b.cashed],
    ['Impayés', b.unpaid],
    ['Kilos lavés chez le cousin', Math.round(b.washKg * 100) / 100],
    ['Lavage chez le cousin', -b.wash],
    ['Marge après lavage', b.margin],
    ['Dépenses courantes', -b.current],
    ['BÉNÉFICE NET', b.net],
    ['Investissements', -b.invest],
    ['Net après investissements', b.netAfterInvest],
    [`À mettre de côté (${S.savingsPercent} % de la marge)`, b.savings],
    ['Part du lavage dans le CA', Math.round(b.washRatio * 1000) / 10 + ' %'],
  ];
  const wsR = sheet(resume, [42, 16]);
  ['B5', 'B7', 'B8', 'B10', 'B11', 'B12', 'B13', 'B14', 'B15', 'B16'].forEach((a) => { if (wsR[a]) wsR[a].z = money; });
  X.utils.book_append_sheet(wb, wsR, 'Résumé');

  const rows = rowsByPeriod(b, p);
  if (p.kind === 'month') {
    X.utils.book_append_sheet(wb, sheet([['Jour', "Chiffre d'affaires (F)"], ...rows.map((r) => [r.label, r.ca])], [10, 22], [1]), 'Par jour');
  } else {
    X.utils.book_append_sheet(wb, sheet([['Mois', "Chiffre d'affaires", 'Lavage cousin', 'Dépenses courantes', 'Bénéfice net', 'Investissements'],
      ...rows.map((r) => [r.label, r.ca, r.wash, r.exp, r.net, r.inv])], [18, 18, 15, 18, 15, 16], [1, 2, 3, 4, 5]), 'Par mois');
  }
  X.utils.book_append_sheet(wb, sheet([['N°', 'Date', 'Client', 'Téléphone', 'Statut', 'Pièces', 'Kg', 'Remise (F)', 'Total (F)', 'Payé (F)', 'Reste dû (F)', 'Lavage (F)', 'Marge (F)'],
    ...b.orderList.map((o) => { const t = orderTotals(o); return [o.number, fmtDate(o.createdAt, false), o.clientName, o.clientPhone || '', STATUS_LABEL[o.status], t.pieces, Math.round(t.washKg * 100) / 100, t.discount, t.total, Math.min(t.paid, t.total), t.due, t.wash, t.margin]; })],
    [6, 11, 22, 14, 14, 7, 6, 11, 12, 11, 12, 11, 11], [7, 8, 9, 10, 11, 12]), 'Factures');
  X.utils.book_append_sheet(wb, sheet([['Date', 'Catégorie', 'Type', 'Détail', 'Montant (F)'],
    ...b.expenseList.map((e) => [fmtDate(e.date, false), catLabel(e.category), catInvest(e.category) ? 'Investissement' : 'Courante', e.label || '', e.amount])],
    [11, 26, 14, 30, 13], [4]), 'Dépenses');
  X.utils.book_append_sheet(wb, sheet([['Article', 'Pièces lavées'], ...Object.entries(b.articles).sort((a, c) => c[1] - a[1])], [34, 14]), 'Articles');

  const out = X.write(wb, { bookType: 'xlsx', type: 'array' });
  return new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
