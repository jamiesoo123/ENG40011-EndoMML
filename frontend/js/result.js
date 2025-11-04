// /static/js/result.js — polished UI + SHAP in PDF

// ---------- Helpers ----------
function getSessionJSON(key) {
  const raw = sessionStorage.getItem(key);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

// Build a map of { featureName: question text } from /data/questions.json
// Build a question text map, preferring the Yes/No (radio) questions
// over follow-up rating (scale10) ones for duplicate features.
async function loadQuestionTextMap() {
  const res = await fetch('/data/questions.json', { cache: 'no-store' });
  if (!res.ok) {
    console.error('Failed to load questions.json', res.status);
    return {};
  }

  const json = await res.json();
  const pages = json.pages || [{ questions: json.questions || [] }];
  const map = {};

  pages.forEach(p => {
    (p.questions || []).forEach(q => {
      const key = q.feature || q.name || `Q${q.id}`;

      // if the feature hasn't been seen yet OR current is a radio (Yes/No), store/replace it
      if (!map[key] || q.type === 'radio') {
        map[key] = q.text || key;
      }
    });
  });

  return map;
}


async function fetchShap(features, top_n = 10) {
  const r = await fetch('/explain', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ features, top_n })
  });
  if (!r.ok) throw new Error(`explain failed: ${r.status}`);
  return r.json();
}

// Normalize backend shapes to [{feature, shap}]
function extractTopContribFromExplain(resp) {
  if (!resp) return [];
  const cand = resp.top_contributors ?? resp.shap_values ?? resp.explanations ?? null;

  if (Array.isArray(cand) && cand.length && Array.isArray(cand[0])) {
    return cand.map(([f, v]) => ({ feature: String(f), shap: Number(v) || 0 }));
  }
  if (Array.isArray(cand) && cand.length && typeof cand[0] === 'object') {
    return cand.map(x => ({
      feature: x.feature ?? x.name ?? String(x[0] ?? 'feature'),
      shap: Number(x.shap ?? x.value ?? x[1] ?? 0)
    }));
  }
  if (cand && typeof cand === 'object') {
    return Object.entries(cand).map(([k, v]) => ({ feature: k, shap: Number(v) || 0 }));
  }
  if (Array.isArray(resp.features) && Array.isArray(resp.values)) {
    return resp.features.map((f, i) => ({ feature: f, shap: Number(resp.values[i]) || 0 }));
  }
  return [];
}

function makeEl(tag, cls = '', html = '') {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (html) el.innerHTML = html;
  return el;
}

function normalizeAnswers(answers) {
  if (!answers) return [];

  const RATING_SUFFIXES = [
    '_rating','rating','_severity','severity',
    '_score','score','_value','value','_intensity','intensity'
  ];

  const stripSuffix = (k) => {
    const lower = k.toLowerCase();
    for (const suf of RATING_SUFFIXES) {
      if (lower.endsWith(suf)) return k.slice(0, k.length - suf.length);
    }
    return k;
  };

  const toYN = (v) => {
    if (typeof v === 'boolean') return v ? 'Yes' : 'No';
    const s = String(v ?? '').trim().toLowerCase();
    if (['true','yes','y','1'].includes(s)) return 'Yes';
    if (['false','no','n','0'].includes(s)) return 'No';
    return null;
  };

  const toNum = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };

  // --- group possible rating and main values ---
  const grouped = new Map();
  for (const [rawKey, rawVal] of Object.entries(answers)) {
    const base = stripSuffix(rawKey);
    const isRatingKey = base !== rawKey;
    const g = grouped.get(base) || { main: null, rating: null };
    if (isRatingKey) {
      const n = toNum(rawVal);
      if (n != null) g.rating = n;
    } else {
      g.main = rawVal;
    }
    grouped.set(base, g);
  }

  const rows = [];
  for (const [base, g] of grouped.entries()) {
    const yn = toYN(g.main);
    let valueText;

    if (yn === 'Yes') {
      // Show "Yes, x/10" if any rating or numeric value exists
      const n = toNum(g.rating ?? g.main);
      if (n != null) {
        const tenScale = n <= 1 ? Math.round(n * 10) : Math.round(n);
        valueText = `Yes, ${tenScale}/10`;
      } else {
        valueText = 'Yes';
      }
    } else if (yn === 'No') {
      valueText = 'No';
    } else {
      // No explicit Yes/No → interpret numeric only (treat as Yes if >0)
      const n = toNum(g.main);
      if (n != null) {
        const tenScale = n <= 1 ? Math.round(n * 10) : Math.round(n);
        if (tenScale > 0) valueText = `Yes, ${tenScale}/10`;
        else valueText = 'No';
      } else {
        valueText = String(g.main ?? '—');
      }
    }

    rows.push({ label: base, value: valueText });
  }

  rows.sort((a, b) =>
    a.label.localeCompare(b.label, undefined, { sensitivity: 'base' })
  );
  return rows;
}


// ---------- SHAP bars (page) ----------
function renderBars(container, contributors, opts = {}) {
  const maxBars = opts.max ?? 10;
  // Contributors can be tuples or objects — use robust access
  const normalized = contributors.map(it => {
    if (Array.isArray(it)) return { feature: String(it[0]), shap: Number(it[1]) || 0 };
    return { feature: it.feature ?? it.name ?? 'feature', shap: Number(it.shap ?? it.value ?? 0) };
  });
  const data = normalized.slice(0, maxBars);
  const maxAbs = Math.max(...data.map(d => Math.abs(d.shap))) || 1;

  container.innerHTML = '';
  const ul = document.createElement('ul');
  ul.className = 'shap-bars';

  data.forEach(item => {
    const width = Math.min(100, (Math.abs(item.shap) / maxAbs) * 100);

    const li = document.createElement('li');
    li.className = 'bar-row';

    const label = document.createElement('span');
    label.className = 'bar-label';
    label.textContent = item.feature;

    const barOuter = document.createElement('div');
    barOuter.className = 'bar-outer';

    const bar = document.createElement('div');
    bar.className = 'bar';
    bar.style.width = `${width}%`;
    bar.style.background = item.shap >= 0 ? '#2563eb' : '#ef4444';
    bar.title = item.shap.toFixed(4);

    const val = document.createElement('span');
    val.className = 'bar-value';
    val.textContent = item.shap.toFixed(4);

    barOuter.appendChild(bar);
    li.appendChild(label);
    li.appendChild(barOuter);
    li.appendChild(val);
    ul.appendChild(li);
  });

  container.appendChild(ul);
}

// ---------- Summary & Answers ----------
function renderSummary(container, result) {
  const pct = (result?.prob1 != null) ? (result.prob1 * 100) : null;
  const pctStr = pct != null ? `${pct.toFixed(1)}%` : '—';

  const card  = makeEl('div', 'summary-card');
  const left  = makeEl('div', 'summary-main');
  const right = makeEl('div', 'summary-side');

  // Single sentence
  const sentence = makeEl(
    'div',
    'summary-sentence',
    `Based on the provided responses, the model predicts a <strong>${pctStr}</strong> probability of endometriosis.`
  );  
  left.appendChild(sentence);

  // Progress bar (kept for visual reinforcement)
  const track = makeEl('div', 'prob-track');
  const fill  = makeEl('div', 'prob-fill');
  fill.style.width = (pct != null ? Math.max(0, Math.min(100, pct)) : 0) + '%';
  track.appendChild(fill);
  left.appendChild(track);

  // Fine print with hover tooltip
  const note = makeEl('div', 'disclaimer');
  note.innerHTML = `
    <span class="info" title="This is an AI-generated risk assessment only, not a medical diagnosis.">
      ⓘ
    </span>
    <span class="muted">This is an AI-generated risk assessment only, not a medical diagnosis.</span>
  `;
  right.appendChild(note);

  card.appendChild(left);
  card.appendChild(right);
  container.innerHTML = '';
  container.appendChild(card);
}


async function renderAnswers(container, answers) {
  const textMap = await loadQuestionTextMap();
  const rows = normalizeAnswers(answers);
  if (!rows.length) {
    container.innerHTML = '<div class="hint">No answers captured.</div>';
    return;
  }

  const grid = makeEl('div', 'answers-grid');
  rows.forEach(({ label, value }) => {
    // Replace feature name with question text if available
    const questionText = textMap[label] || label;
    const row = makeEl('div', 'answers-row');
    row.innerHTML = `
      <div class="answers-key">${questionText}</div>
      <div class="answers-val">${value}</div>
    `;
    grid.appendChild(row);
  });

  container.innerHTML = '';
  container.appendChild(grid);
}

// ---------- PDF helpers ----------
function drawShapBarsPDF(doc, top, startX, startY, maxWidth) {
  const maxAbs = Math.max(...top.map(t => Math.abs(t.shap))) || 1;
  const lineH = 7;      // vertical spacing per row
  const barH  = 4;      // bar thickness
  let y = startY;

  doc.setFontSize(12);
  doc.text('Top Contributors (SHAP)', startX, y);
  y += 6;

  doc.setFontSize(10);
  top.forEach(({ feature, shap }) => {
    if (y > 285) { doc.addPage(); y = 12; } // new page if near bottom

    // Label
    doc.text(String(feature), startX, y);

    // Bar
    const norm = Math.abs(shap) / maxAbs;
    const w = Math.max(0.5, Math.min(1, norm)) * maxWidth;

    const barX = startX + 60;
    const barY = y - (barH - 2) / 2;

    if (shap >= 0) doc.setFillColor(37, 99, 235);  // #2563eb
    else           doc.setFillColor(239, 68, 68);  // #ef4444
    doc.rect(barX, barY, w, barH, 'F');

    // Value
    doc.setTextColor(0, 0, 0);
    doc.text(shap.toFixed(4), barX + w + 4, y);

    y += lineH;
  });

  return y;
}

// ---------- PDF (async, fetches SHAP if missing) ----------
// ---------- Nicer, webapp-like PDF ----------
async function generatePDF() {
  const result  = getSessionJSON('endo_result');
  let   explain = getSessionJSON('endo_explain');
  const feats   = getSessionJSON('endo_features');

  if (!result) {
    alert('No survey result found.');
    return;
  }

  // Ensure SHAP is available
  if (!explain && feats) {
    try {
      explain = await fetchShap(feats, 10);
      sessionStorage.setItem('endo_explain', JSON.stringify(explain));
    } catch {
      explain = null;
    }
  }

  const top = extractTopContribFromExplain(explain);
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });

  const pct = (result?.prob1 != null) ? (result.prob1 * 100).toFixed(1) : '—';
  const answers = result.answers || {};
  let y = 20;

  // --- Header ---
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.text('Endometriosis Symptom Survey Results', 105, y, { align: 'center' });
  y += 10;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(12);
  doc.text('This document summarises your responses and the estimated likelihood of endometriosis.', 105, y, { align: 'center' });
  y += 10;

  // --- Probability Card ---
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text('Predicted Probability', 105, y, { align: 'center' });
  y += 8;

  const pctNum = parseFloat(pct);
  const barWidth = 100;
  const barX = 55;
  const barY = y;
  const barFill = isNaN(pctNum) ? 0 : Math.min(100, pctNum);

  doc.setDrawColor(200);
  doc.setFillColor(240, 240, 240);
  doc.rect(barX, barY, barWidth, 8, 'F'); // background
  doc.setFillColor(37, 99, 235);
  doc.rect(barX, barY, (barWidth * barFill) / 100, 8, 'F'); // filled portion
  y += 6;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(37, 99, 235);
  doc.text(`${pct}%`, 105, y + 10, { align: 'center' });
  doc.setTextColor(0, 0, 0);
  y += 18;

  doc.setFont('helvetica', 'italic');
  doc.setFontSize(10);
  doc.text(
    'Note: This is an AI-generated risk estimate from your responses, not a diagnosis.',
    105, y, { align: 'center', maxWidth: 180 }
  );
  y += 12;

  // --- SHAP Section ---
  if (top.length) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.text('Top Contributors (SHAP)', 10, y);
    y += 6;

    const maxAbs = Math.max(...top.map(t => Math.abs(t.shap))) || 1;
    doc.setFontSize(10);
    top.slice(0, 10).forEach(({ feature, shap }) => {
      if (y > 270) { doc.addPage(); y = 20; }
      const barX = 65;
      const width = (Math.abs(shap) / maxAbs) * 80;
      doc.text(feature, 10, y + 4);
      doc.setFillColor(shap >= 0 ? 37 : 239, shap >= 0 ? 99 : 68, shap >= 0 ? 235 : 68);
      doc.rect(barX, y, width, 4, 'F');
      doc.text(shap.toFixed(3), barX + width + 4, y + 4);
      y += 7;
    });

    y += 4;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setFillColor(37, 99, 235); doc.rect(10, y - 3, 6, 3, 'F');
    doc.text('Positive influence (raises prediction)', 20, y);
    y += 5;
    doc.setFillColor(239, 68, 68); doc.rect(10, y - 3, 6, 3, 'F');
    doc.text('Negative influence (lowers prediction)', 20, y);
    y += 10;
  }

  // --- Responses Section ---
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text('Your Responses', 10, y);
  y += 8;

  const textMap = await loadQuestionTextMap();
  const rows = normalizeAnswers(answers);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);

  rows.forEach(({ label, value }) => {
    const question = textMap[label] || label;
    const formatted = `${question}: ${value}`;
    const wrapped = doc.splitTextToSize(formatted, 180);
    wrapped.forEach(line => {
      if (y > 280) { doc.addPage(); y = 20; }
      doc.text(line, 10, y);
      y += 6;
    });
  });

  // --- Footer ---
  if (y > 270) doc.addPage();
  doc.setFont('helvetica', 'italic');
  doc.setFontSize(9);
  doc.text(
    'Generated by the Endometriosis Symptom Survey Tool',
    105, 290, { align: 'center' }
  );

  doc.save('Endometriosis_Survey_Results.pdf');
}


// ---------- Main ----------
async function render() {
  const result = getSessionJSON('endo_result');
  const feats  = getSessionJSON('endo_features');

  const summary     = document.getElementById('summary');
  const answersBox  = document.getElementById('answersList');
  const explainBox  = document.getElementById('explainBox');
  const explainList = document.getElementById('explainList');

  if (!result || !feats) {
    summary.innerHTML = `<div class="hint" style="color:#b00">No result in session. Please complete the survey.</div>`;
    return;
  }

  // Summary
  renderSummary(summary, result);

  // SHAP (above answers)
  explainList.innerHTML = '<p>Loading SHAP summary...</p>';
  try {
    const explain = await fetchShap(feats, 10);
    sessionStorage.setItem('endo_explain', JSON.stringify(explain));

    if (explain.top_contributors && explain.top_contributors.length) {
      explainBox.hidden = false;
      renderBars(explainList, explain.top_contributors, { max: 10 });
    } else {
      explainList.innerHTML = '<p>No SHAP data available for this sample.</p>';
    }
  } catch (err) {
    explainList.innerHTML = `<p style="color:#b00">Failed to load SHAP: ${err.message}</p>`;
    console.error('SHAP error:', err);
  }

  // Answers (below SHAP)
  renderAnswers(answersBox, result.answers);
}

document.addEventListener('DOMContentLoaded', () => {
  render();
  const btn = document.getElementById('btnPDF');
  if (btn) btn.addEventListener('click', async () => { await generatePDF(); });
  console.log('result.js ready');
});
