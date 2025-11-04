import { postJSON } from './api.js'
import { toNumeric } from './util.js'

// Build form from questions.json and wire submit → /predict
export async function buildForm({ formId, resultId, questionsUrl, predictUrl }) {
  const form = document.getElementById(formId)
  const out  = document.getElementById(resultId)

  if (!form) throw new Error(`Form element #${formId} not found`)

  // Load questionnaire spec
  const resp = await fetch('/data/questions.json')
  if (!resp.ok) throw new Error(`Failed to load ${questionsUrl}`)
  const spec = await resp.json()

  // Optional: heading/intro
  if (spec.title) {
    const h = document.createElement('h2')
    h.textContent = spec.title
    form.appendChild(h)
  }
  if (spec.description) {
    const p = document.createElement('p')
    p.className = 'hint'
    p.textContent = spec.description
    form.appendChild(p)
  }

  // Render questions
  for (const q of spec.questions) {
    const block = document.createElement('div')
    block.className = 'question'

    const label = document.createElement('label')
    label.textContent = q.text
    block.appendChild(label)

    const nameAttr = q.feature || q.name || `Q${q.id}` // feature name = model column!

    if (q.type === 'radio') {
      for (let i = 0; i < q.options.length; i++) {
        const opt = q.options[i]
        const id = `${nameAttr}_${i}`

        const wrap = document.createElement('div')
        wrap.className = 'inline'

        const input = document.createElement('input')
        input.type = 'radio'
        input.id = id
        input.name = nameAttr
        input.value = opt
        input.required = true

        const lab = document.createElement('label')
        lab.setAttribute('for', id)
        lab.textContent = opt

        wrap.appendChild(input)
        wrap.appendChild(lab)
        block.appendChild(wrap)
      }
    } else if (q.type === 'number') {
      const input = document.createElement('input')
      input.type = 'number'
      input.name = nameAttr
      if (q.min !== undefined) input.min = q.min
      if (q.max !== undefined) input.max = q.max
      if (q.step !== undefined) input.step = q.step
      input.required = true
      block.appendChild(input)
    } else if (q.type === 'select') {
      const sel = document.createElement('select')
      sel.name = nameAttr
      for (const opt of q.options) {
        const o = document.createElement('option')
        o.value = opt
        o.textContent = opt
        sel.appendChild(o)
      }
      block.appendChild(sel)
    } else if (q.type === 'text') {
      const ta = document.createElement('textarea')
      ta.name = nameAttr
      block.appendChild(ta)
    }

    if (q.hint) {
      const hint = document.createElement('div')
      hint.className = 'hint'
      hint.textContent = q.hint
      block.appendChild(hint)
    }

    form.appendChild(block)
  }

  // Submit button
  const btn = document.createElement('button')
  btn.type = 'submit'
  btn.textContent = 'Get Prediction'
  form.appendChild(btn)

  // Submit handler
  form.addEventListener('submit', async (e) => {
    e.preventDefault()

    // Collect features as numbers
    const fd = new FormData(form)
    const features = {}
    for (const [k, v] of fd.entries()) {
      features[k] = toNumeric(v)
    }

    // Call backend
    out.hidden = false
    out.textContent = 'Loading…'

    try {
      const res = await postJSON(predictUrl, { features })
      const pct = (res.prob1 * 100).toFixed(1)
      out.innerHTML = `
        <div><strong>Predicted Probability:</strong> ${pct}%</div>
        <div><strong>Predicted Label:</strong> ${res.pred}</div>
      `
    } catch (err) {
      out.innerHTML = `<span style="color:#b00">Error: ${err.message}</span>`
    }
  })
}
