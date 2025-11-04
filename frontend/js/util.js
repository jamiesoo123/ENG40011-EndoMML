// Map common strings to numbers (Yes/No, True/False). Leave numbers as-is.
export function toNumeric(v) {
  if (v === null || v === undefined) return 0
  const n = Number(v)
  if (!Number.isNaN(n)) return n
  const s = String(v).trim().toLowerCase()
  if (['yes', 'true', 'y'].includes(s)) return 1
  if (['no', 'false', 'n'].includes(s)) return 0
  return 0
}
