// /frontend/js/result.js
(function () {
  const box = document.getElementById('results');
  const data = sessionStorage.getItem('endo_result');
  if (!data) {
    box.innerHTML = '<p>No result found. Please complete the survey first.</p>';
    return;
  }
  const { prob1, pred } = JSON.parse(data);
  const pct = (prob1 * 100).toFixed(1);
  box.innerHTML = `
    <p><strong>Predicted probability:</strong> ${pct}%</p>
    <p><strong>Model decision:</strong> ${pred === 1 ? 'Possible Endometriosis' : 'Unlikely Endometriosis'}</p>
  `;
})();
