// /static/js/result.js — polished UI + SHAP in PDF

// ---------- Helpers ----------
function getSessionJSON(key) {
  const raw = sessionStorage.getItem(key);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
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
  const pct = (result.prob1 != null) ? (result.prob1 * 100) : null;
  const pctStr = pct != null ? `${pct.toFixed(1)}%` : '—';
  const isPositive = result.pred === 1;
  const label = result.label ?? (isPositive ? 'Endometriosis' : 'No Endometriosis');

  const card = makeEl('div', 'summary-card');
  const left = makeEl('div', 'summary-main');
  const right = makeEl('div', 'summary-side');

  left.appendChild(makeEl('div', 'prob-badge', pctStr));

  // progress track
  const track = makeEl('div', 'prob-track');
  const fill = makeEl('div', 'prob-fill');
  fill.style.width = (pct != null ? Math.max(0, Math.min(100, pct)) : 0) + '%';
  track.appendChild(fill);
  left.appendChild(track);

  const pill = makeEl('span', `decision-pill ${isPositive ? 'pill-pos' : 'pill-neg'}`, label);
  right.appendChild(pill);

  card.appendChild(left);
  card.appendChild(right);
  container.innerHTML = '';
  container.appendChild(card);
}

function renderAnswers(container, answers) {
  const entries = Object.entries(answers || {});
  if (!entries.length) {
    container.innerHTML = '<div class="hint">No answers captured.</div>';
    return;
  }

  const grid = makeEl('div', 'answers-grid');
  entries.forEach(([k, v]) => {
    const row = makeEl('div', 'answers-row');
    row.appendChild(makeEl('div', 'answers-key', k));
    row.appendChild(makeEl('div', 'answers-val', String(v)));
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
async function generatePDF() {
  const result  = getSessionJSON('endo_result');
  let   explain = getSessionJSON('endo_explain');
  const feats   = getSessionJSON('endo_features');

  if (!result) { alert('No survey result found.'); return; }

  // Ensure we have SHAP for the PDF
  if (!explain && feats) {
    try {
      explain = await fetchShap(feats, 10);
      sessionStorage.setItem('endo_explain', JSON.stringify(explain));
    } catch {
      // continue without SHAP
      explain = null;
    }
  }
  const top = extractTopContribFromExplain(explain);

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();

  // Header
  const pct = (result.prob1 != null) ? (result.prob1 * 100).toFixed(1) + '%' : '—';
  const label = result.label ?? (result.pred === 1 ? 'Endometriosis' : 'No Endometriosis');
  const answers = result.answers || {};

  doc.setFontSize(16);
  doc.text('Endometriosis Symptom Survey', 10, 12);

  doc.setFontSize(12);
  doc.text(`Predicted Probability: ${pct}`, 10, 22);
  doc.text(`Model Decision: ${label}`, 10, 29);

  let y = 36;

  // SHAP section (if available)
  if (top.length) {
    y = drawShapBarsPDF(doc, top, 10, y, 110);
    y += 4;

    // Legend
    if (y > 285) { doc.addPage(); y = 12; }
    doc.setFontSize(10);
    doc.setFillColor(37, 99, 235); doc.rect(10, y - 3, 8, 4, 'F');
    doc.setTextColor(0, 0, 0); doc.text('Positive influence (raises prediction)', 20, y);
    y += 6;
    doc.setFillColor(239, 68, 68); doc.rect(10, y - 3, 8, 4, 'F');
    doc.text('Negative influence (lowers prediction)', 20, y);
    y += 10;
  }

  // Answers
  doc.setFontSize(14);
  if (y > 270) { doc.addPage(); y = 12; }
  doc.text('Patient Responses', 10, y); y += 8;

  doc.setFontSize(12);
  for (const [q, a] of Object.entries(answers)) {
    const lines = doc.splitTextToSize(`${q}: ${a}`, 180);
    for (const line of lines) {
      if (y > 285) { doc.addPage(); y = 12; }
      doc.text(line, 10, y); y += 7;
    }
  }

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
