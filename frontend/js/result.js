function renderBars(container, items, {max = 10} = {}) {
  container.innerHTML = '';
  const top = items.slice(0, max);
  const maxAbs = Math.max(...top.map(([, v]) => Math.abs(v))) || 1;

  top.forEach(([name, val]) => {
    const block = document.createElement('div');
    block.className = 'shap-bar';

    const label = document.createElement('div');
    label.className = 'shap-bar-label';
    label.textContent = `${name} (${val >= 0 ? '+' : ''}${val.toFixed(3)})`;

    const wrap = document.createElement('div');
    wrap.className = 'shap-bar-wrap';

    const fill = document.createElement('div');
    fill.className = 'shap-bar-fill ' + (val >= 0 ? 'positive' : 'negative');
    fill.style.width = `${(Math.abs(val) / maxAbs) * 100}%`;

    wrap.appendChild(fill);
    block.appendChild(label);
    block.appendChild(wrap);
    container.appendChild(block);
  });
}

(async function () {
  const predictionBox = document.getElementById('prediction');
  const barsBox = document.getElementById('shap-bars');

  // Get stored prediction and features
  const resultRaw = sessionStorage.getItem('endo_result');
  const featuresRaw = sessionStorage.getItem('endo_features');

  if (!resultRaw || !featuresRaw) {
    predictionBox.innerHTML = '<p>No result found. Please complete the survey first.</p>';
    return;
  }

  const result = JSON.parse(resultRaw);
  const features = JSON.parse(featuresRaw);
  const pct = (result.prob1 * 100).toFixed(1);

  // --- Display prediction ---
  predictionBox.innerHTML = `
    <p><strong>Predicted Probability:</strong> ${pct}%</p>
    <p><strong>Prediction:</strong> ${
      result.pred === 1 ? 'Possible Endometriosis' : 'Unlikely Endometriosis'
    }</p>
  `;

  // --- Request SHAP explanation ---
  barsBox.innerHTML = '<p>Loading SHAP summary...</p>';
  try {
    const res = await fetch('/explain', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ features, top_n: 10 })
    });

    if (!res.ok) throw new Error(`API error ${res.status}`);
    const shap = await res.json();

    // Draw bars
    renderBars(barsBox, shap.top_contributors, { max: 10 });
  } catch (err) {
    barsBox.innerHTML = `<p style="color:#b00">Failed to load SHAP: ${err.message}</p>`;
  }
})();
