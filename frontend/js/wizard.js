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
  const form = document.getElementById('surveyForm');
  const header = document.getElementById('pageHeader');
  const container = document.getElementById('questions');
  const bar = document.getElementById('progressBar');
  const btnBack = document.getElementById('btnBack');
  const btnNext = document.getElementById('btnNext');
  const btnSubmit = document.getElementById('btnSubmit');
  const out = document.getElementById('resultBox');

  // 1) load spec (must exist at /data/questions.json)
  const spec = await fetch('/data/questions.json', { cache: 'no-store' }).then(r => r.json());
  const pages = spec.pages || [{ id: 'one', title: spec.title || 'Survey', questions: spec.questions || [] }];
  const typeByFeature = buildTypeMap(pages);

  // 2) state
  let pageIdx = 0;
  const answers = {};

  function updateProgress() {
    const pct = Math.round(((pageIdx + 1) / pages.length) * 100);
    bar.style.width = pct + '%';
  }

  function renderPage() {
    container.innerHTML = '';
    const page = pages[pageIdx];
    header.innerHTML = `<h2>${page.title || ''}</h2>${page.description ? `<p class="hint">${page.description}</p>` : ''}`;
    page.questions.forEach(q => {
      const f = q.feature || q.name || `Q${q.id}`;
      const node = renderQuestion(q, answers[f]);
      container.appendChild(node);
    });

    btnBack.style.display  = (pageIdx === 0) ? 'none' : '';
    btnNext.style.display  = (pageIdx === pages.length - 1) ? 'none' : '';
    btnSubmit.style.display = (pageIdx === pages.length - 1) ? '' : 'none';

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

  btnBack.addEventListener('click', () => {
    readCurrentPageInputs();
    if (pageIdx > 0) { pageIdx--; renderPage(); }
  });

  btnNext.addEventListener('click', () => {
    readCurrentPageInputs();
    const v = validateCurrentPage();
    if (!v.ok) { alert(v.message); return; }
  
    const page = pages[pageIdx];
    const firstQ = page.questions[0];
    const answer = answers[firstQ.feature];
  
    // if "No" and next page is only for rating, skip it
    if (firstQ.type === "radio" && answer && answer.toLowerCase() === "no" && firstQ.next_if_yes) {
      // find the index of the page after the "next_if_yes"
      const nextPageIdx = pages.findIndex(p => p.id === firstQ.next_if_yes);
      if (nextPageIdx !== -1 && nextPageIdx + 1 < pages.length) {
        pageIdx = nextPageIdx + 1; // skip the severity page
        renderPage();
        return;
      }
    }
  
    // if "Yes" and we have next_if_yes go there directly
    if (firstQ.type === "radio" && answer && answer.toLowerCase() === "yes" && firstQ.next_if_yes) {
      const nextPageIdx = pages.findIndex(p => p.id === firstQ.next_if_yes);
      if (nextPageIdx !== -1) {
        pageIdx = nextPageIdx;
        renderPage();
        return;
      }
    }
  
    // otherwise normal next
    if (pageIdx < pages.length - 1) {
      pageIdx++;
      renderPage();
    }
  });
  
  

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    readCurrentPageInputs();
  
    const features = normalise(answers, typeByFeature);
  
    out.hidden = false;
    out.textContent = 'Loading…';
  
    try {
      console.log('[wizard] POST /predict', features);
      const res = await fetch('/predict', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ features })
      });
  
      if (!res.ok) {
        const txt = await res.text().catch(() => '');
        console.error('[wizard] /predict failed', res.status, txt);
        out.innerHTML = `<span style="color:#b00">API error ${res.status}</span>`;
        return;
      }
  
      const json = await res.json();
      console.log('[wizard] /predict ok', json);
  
      // Save for the results page
      sessionStorage.setItem('endo_result', JSON.stringify(json));
      sessionStorage.setItem('endo_features', JSON.stringify(features));
  
      // Optional inline flash
      const pct = (json.prob1 * 100).toFixed(1);
      out.innerHTML = `
        <div><strong>Predicted Probability:</strong> ${pct}%</div>
        <div><strong>Predicted Label:</strong> ${json.pred}</div>
        <div class="hint">Redirecting…</div>
      `;
  
      // Strong redirect
      window.location.replace('/result');
      // Failsafe (in case of popup blockers or odd environments)
      setTimeout(() => { if (location.pathname !== '/result') location.href = '/result'; }, 100);
  
    } catch (err) {
      console.error('[wizard] submit error', err);
      out.innerHTML = `<span style="color:#b00">Error: ${err.message}</span>`;
    }
  });

  form.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault(); // stop form submission
      // emulate "Next" button click if it's visible
      if (!btnNext.hidden) {
        btnNext.click();
      }
    }
  });
  

  renderPage();
}

// auto-run on survey.html
startWizard();
