// /frontend/js/wizard.js  (auto-advance for Yes/No; Next button for sliders)

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
  return n / 10;
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
    out[k] = (t === 'scale10') ? scale10To01(raw) : yesNoTo01(raw);
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

  // Load survey spec
  const spec = await fetch('/data/questions.json', { cache: 'no-store' }).then(r => r.json());
  const pages = spec.pages || [{ id: 'one', title: spec.title || 'Survey', questions: spec.questions || [] }];
  const typeByFeature = buildTypeMap(pages);

  // State
  let pageIdx = 0;
  const answers = {};

  function updateProgress() {
    const pct = Math.round(((pageIdx + 1) / pages.length) * 100);
    bar.style.width = pct + '%';
  }

  // Read current page inputs into `answers`.
  function readCurrentPageInputs() {
    const fd = new FormData(form);
    pages[pageIdx].questions.forEach(q => {
      const f = q.feature || q.name || `Q${q.id}`;
      if (fd.has(f)) {
        answers[f] = fd.get(f);
      } else if (q.type === 'scale10') {
        // if slider not touched, still capture its current DOM value
        const el = form.querySelector(`[name="${f}"]`);
        if (el) answers[f] = el.value;
      }
    });
  }

  // Validate all questions on the current page have some value
  function validateCurrentPage() {
    const fd = new FormData(form);
    for (const q of pages[pageIdx].questions) {
      const f = q.feature || q.name || `Q${q.id}`;
      const hasValue =
        (answers[f] !== undefined && answers[f] !== '') ||
        (fd.has(f) && fd.get(f) !== '') ||
        (q.type === 'scale10' && form.querySelector(`[name="${f}"]`));
      if (!hasValue) {
        return { ok: false, message: `Please answer: "${q.text}"` };
      }
    }
    return { ok: true };
  }

  // Navigation logic for Yes/No branching + default next
  function advanceFromCurrent(selectedValue) {
    const page = pages[pageIdx];
    const firstQ = page.questions[0];

    // If "No" and there is a next_if_yes (severity page), skip it
    if (firstQ && String(selectedValue).toLowerCase() === 'no' && firstQ.next_if_yes) {
      const nextPageIdx = pages.findIndex(p => p.id === firstQ.next_if_yes);
      if (nextPageIdx !== -1 && nextPageIdx + 1 < pages.length) {
        pageIdx = nextPageIdx + 1;
        renderPage();
        return;
      }
    }

    // If "Yes" and next_if_yes exists, go directly there
    if (firstQ && String(selectedValue).toLowerCase() === 'yes' && firstQ.next_if_yes) {
      const nextPageIdx = pages.findIndex(p => p.id === firstQ.next_if_yes);
      if (nextPageIdx !== -1) {
        pageIdx = nextPageIdx;
        renderPage();
        return;
      }
    }

    // Otherwise, normal next
    if (pageIdx < pages.length - 1) {
      pageIdx++;
      renderPage();
    }
  }

  function renderQuestion(q) {
    const nameAttr = q.feature || q.name || `Q${q.id}`;
    const block = document.createElement('div');
    block.className = 'question';

    const label = document.createElement('label');
    label.textContent = q.text;
    block.appendChild(label);

    if (q.type === 'radio') {
      // Yes/No as buttons -> auto-advance
      const opts = q.options || ['No', 'Yes'];
      const btnRow = document.createElement('div');
      btnRow.className = 'controls';

      opts.forEach(opt => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn';
        btn.textContent = opt;
        btn.addEventListener('click', () => {
          answers[nameAttr] = opt;
          advanceFromCurrent(opt);
        });
        btnRow.appendChild(btn);
      });

      block.appendChild(btnRow);

    } else if (q.type === 'scale10') {
      // Slider (no auto-advance)
      const wrap = document.createElement('div');
      wrap.className = 'controls';

      const input = document.createElement('input');
      input.type = 'range';
      input.name = nameAttr;              // critical so FormData sees it
      input.min = '1'; input.max = '10'; input.step = '1';
      input.value = answers[nameAttr] ? String(answers[nameAttr]) : '5';

      const readout = document.createElement('span');
      readout.className = 'hint';
      readout.textContent = `${input.value} / 10`;

      input.addEventListener('input', () => {
        readout.textContent = `${input.value} / 10`;
        answers[nameAttr] = input.value;  // keep answers updated as they slide
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

  function renderPage() {
    container.innerHTML = '';
    const page = pages[pageIdx];
    header.innerHTML = `<h2>${page.title || ''}</h2>${page.description ? `<p class="hint">${page.description}</p>` : ''}`;

    page.questions.forEach(q => {
      const node = renderQuestion(q);
      container.appendChild(node);
    });

    const hasScale = page.questions.some(q => q.type === 'scale10');
    btnBack.style.display = (pageIdx === 0) ? 'none' : '';
    btnNext.style.display = (hasScale && pageIdx < pages.length - 1) ? '' : 'none';
    btnSubmit.style.display = (pageIdx === pages.length - 1) ? '' : 'none';

    updateProgress();
  }

  // Back button
  btnBack.addEventListener('click', () => {
    if (pageIdx > 0) { pageIdx--; renderPage(); }
  });

  // NEXT button (used on slider pages)
  btnNext.addEventListener('click', () => {
    readCurrentPageInputs();
    const v = validateCurrentPage();
    if (!v.ok) { alert(v.message); return; }
    if (pageIdx < pages.length - 1) {
      pageIdx++;
      renderPage();
    }
  });

  // Submit -> call /predict, save, redirect to /result
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    readCurrentPageInputs(); // be sure last page values are captured

    const features = normalise(answers, typeByFeature);
    out.hidden = false;
    out.textContent = 'Loading…';

    try {
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
      sessionStorage.setItem('endo_result', JSON.stringify({ ...json, answers }));
      sessionStorage.setItem('endo_features', JSON.stringify(features));
      window.location.replace('/result');   // or '/result.html' if static file

    } catch (err) {
      console.error('[wizard] submit error', err);
      out.innerHTML = `<span style="color:#b00">Error: ${err.message}</span>`;
    }
  });

  // Prevent Enter from submitting (we control navigation)
  form.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') e.preventDefault();
  });

  renderPage();
}

startWizard();
