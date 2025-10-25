// /frontend/js/wizard.js

function yesNoTo01(v) {
  const s = String(v).trim().toLowerCase();
  if (['yes','y','true','1'].includes(s)) return 1;
  if (['no','n','false','0'].includes(s)) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function scale10To01(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return n / 10; // maps 1..10 => 0.1..1.0
}

function renderQuestion(q, savedValue) {
  const nameAttr = q.feature || q.name || `Q${q.id}`;
  const block = document.createElement('div');
  block.className = 'question';

  const label = document.createElement('label');
  label.textContent = q.text;
  block.appendChild(label);

  if (q.type === 'radio') {
    const opts = q.options || ['No','Yes'];
    opts.forEach((opt, i) => {
      const id = `${nameAttr}_${i}`;
      const wrap = document.createElement('div');
      wrap.className = 'inline';

      const input = document.createElement('input');
      input.type = 'radio';
      input.id = id;
      input.name = nameAttr;
      input.value = opt;
      input.required = true;
      if (savedValue !== undefined && String(savedValue) === String(opt)) {
        input.checked = true;
      }

      const lab = document.createElement('label');
      lab.setAttribute('for', id);
      lab.textContent = opt;

      wrap.appendChild(input);
      wrap.appendChild(lab);
      block.appendChild(wrap);
    });
  } else if (q.type === 'scale10') {
    const wrap = document.createElement('div');
    wrap.className = 'controls';

    const input = document.createElement('input');
    input.type = 'range';
    input.name = nameAttr;
    input.min = '1'; input.max = '10'; input.step = '1';
    input.value = savedValue ? String(savedValue) : '5';

    const readout = document.createElement('span');
    readout.className = 'hint';
    readout.textContent = `${input.value} / 10`;

    input.addEventListener('input', () => {
      readout.textContent = `${input.value} / 10`;
    });

    wrap.appendChild(input);
    wrap.appendChild(readout);
    block.appendChild(wrap);
  }

  if (q.hint) {
    const hint = document.createElement('div');
    hint.className = 'hint';
    hint.textContent = q.hint;
    block.appendChild(hint);
  }
  return block;
}

async function fetchJSON(url) {
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) throw new Error(`Failed to load ${url}`);
  return r.json();
}

function buildTypeMap(pages) {
  const map = {};
  pages.forEach(p => p.questions.forEach(q => {
    const f = q.feature || q.name || `Q${q.id}`;
    map[f] = q.type;
  }));
  return map;
}

function normalise(featuresRaw, typeByFeature) {
  const out = {};
  for (const [k, raw] of Object.entries(featuresRaw)) {
    const t = typeByFeature[k];
    if (t === 'scale10') out[k] = scale10To01(raw);
    else out[k] = yesNoTo01(raw);
  }
  return out;
}

async function startWizard() {
  // get all of the data from the html file and store it as a constant
  const form = document.getElementById('surveyForm');
  const header = document.getElementById('pageHeader');
  const container = document.getElementById('questions');
  const bar = document.getElementById('progressBar');
  const btnBack = document.getElementById('btnBack');
  const btnNext = document.getElementById('btnNext');
  const btnSubmit = document.getElementById('btnSubmit');
  const out = document.getElementById('resultBox');

  // download button on the final page for the results pdf
  const btnDownload = document.createElement('button');
  btnDownload.textContent = 'Download PDF Report';
  btnDownload.className = 'btn primary';
  btnDownload.style.display = 'none';
  btnDownload.addEventListener('click', generatePDF);
  out.appendChild(btnDownload);

  // 1) read in questions from '/data/questions.json'
  const spec = await fetchJSON('/data/questions.json');
  const pages = spec.pages || [{ id: 'one', title: spec.title || 'Survey', questions: spec.questions || [] }];
  const typeByFeature = buildTypeMap(pages);

  // 2) page state
  let pageIdx = 0;
  const answers = {}; // store user answers

  // bar at the top with % of completion
  function updateProgress() {
    const pct = Math.round(((pageIdx + 1) / pages.length) * 100);
    bar.style.width = pct + '%';
  }

  // clear container and then add current page questions, update bar and show nav buttons
  function renderPage() {
    container.innerHTML = '';
    const page = pages[pageIdx];
    header.innerHTML = `<h2>${page.title || ''}</h2>${page.description ? `<p class="hint">${page.description}</p>` : ''}`;
    page.questions.forEach(q => {
      const f = q.feature || q.name || `Q${q.id}`;
      const node = renderQuestion(q, answers[f]);
      container.appendChild(node);
    });

    btnBack.hidden = pageIdx === 0;
    btnNext.hidden = pageIdx === pages.length - 1;
    btnSubmit.hidden = !(pageIdx === pages.length - 1);
    updateProgress();
  }

  function readCurrentPageInputs() {
    const fd = new FormData(form);
    pages[pageIdx].questions.forEach(q => {
      const f = q.feature || q.name || `Q${q.id}`;
      if (fd.has(f)) answers[f] = fd.get(f);
    });
  }

  function validateCurrentPage() {
    for (const q of pages[pageIdx].questions) {
      const f = q.feature || q.name || `Q${q.id}`;
      if (answers[f] === undefined || answers[f] === '') {
        return { ok: false, message: `Please answer: "${q.text}"` };
      }
    }
    return { ok: true };
  }

  function generatePDF() {
    const data = sessionStorage.getItem('endo_result'); 
    if (!data) { 
      alert('No survey result found'); 
      return; 
    }

    const { prob1, pred, answers } = JSON.parse(data);
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF;

    doc.setFontSize(16);
    doc.text("Endometriosis Symptom Survey", 10, 10)

    doc.setFontSize(12);
    doc.text(`Predicted Probability: ${(prob1 * 100).toFixed(1)}%`, 10, 20);
    doc.text(`Model Decision: ${pred === 1 ? 'Possible Endometriosis' : 'Unlikely Endometriosis'}`, 10, 28);

    doc.setFontSize(14);
    doc.text('Patient Responses', 10, 38);

    let y = 46;
    for (const [q,a] of Object.entries(answers)) {
      doc.text(`${q}: ${a}`, 10, y);
      y += 8;

      if (y > 280) {
        doc.addPage();
        y = 10;
      }
    }
    doc.save('Endometriosis_Survey.pdf');
  }

  btnBack.addEventListener('click', () => {
    readCurrentPageInputs();
    if (pageIdx > 0) { pageIdx--; renderPage(); }
  });

  btnNext.addEventListener('click', () => {
    readCurrentPageInputs();
    const v = validateCurrentPage();
    if (!v.ok) { alert(v.message); return; }
    if (pageIdx < pages.length - 1) { pageIdx++; renderPage(); }
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    readCurrentPageInputs();
    const v = validateCurrentPage();
    if (!v.ok) { alert(v.message); return; }

    const features = normalise(answers, typeByFeature);

    out.hidden = false;
    out.textContent = 'Loading…';

    // try to send the answer data to the model
    try {
      const res = await fetch('/predict', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ features })
      });
      if (!res.ok) throw new Error(`API error ${res.status}`);
      const json = await res.json();

      const pct = (json.prob1 * 100).toFixed(1);
      out.innerHTML = `
        <div><strong>Predicted Probability:</strong> ${pct}%</div>
        <div><strong>Predicted Label:</strong> ${json.pred}</div>
      `;

      sessionStorage.setItem('endo_result', JSON.stringify({ ...json, answers })); // stores the answers and pred/% in sessionData
      
      btnDownload.style.display = 'inline-block'; // only appear once the submit button has been pressed
    } catch (err) {
      out.innerHTML = `<span style="color:#b00">Error: ${err.message}</span>`;
    }
  });

  renderPage();
}

// auto-run on survey.html
startWizard();