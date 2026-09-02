// Assignment Suggestion Engine
//
// Picks which caregiver should be suggested for an unassigned task by combining:
//   - a base "current load" score  (how many active tasks each caregiver holds)
//   - workloadManager.evaluateCaregiverWorkload  (48h shift-density / needs-rest)
//   - silentLoadEngine.checkSilentLoad           (consecutive-week burnout streaks)
//
// Pure ES module: safe to import from both Node and the browser.

import { evaluateCaregiverWorkload } from './workloadManager.mjs'
import { checkSilentLoad } from './silentLoadEngine.mjs'

// Penalties are large enough to always outrank a raw task-count difference.
const NEEDS_REST_PENALTY = 100
const BURNOUT_PENALTY = 100
const MODERATE_LOAD_PENALTY = 5

// Small stable string hash, used only to break ties between equally-loaded
// caregivers so different unassigned tasks don't all suggest the same person.
function hashString(str) {
  let h = 0
  for (let i = 0; i < str.length; i++) h = (Math.imul(31, h) + str.charCodeAt(i)) | 0
  return h >>> 0
}

// Turn a YYYY-MM-DD string into a monotonic integer week index (no year collisions).
function weekIndex(dateStr) {
  const t = new Date(dateStr).getTime()
  if (Number.isNaN(t)) return 0
  return Math.floor(t / (7 * 24 * 60 * 60 * 1000))
}

/**
 * @param {{name: string}[]} caregivers        candidate caregivers
 * @param {{id,title,assignedTo,date,time}[]} schedule   current active tasks (assignee by name, "Unassigned" allowed)
 * @param {{id,title,date,time}} targetTask     the unassigned task we want a suggestion for
 * @param {object} [opts]
 * @param {number} [opts.burnoutThresholdWeeks=3]
 * @returns {{ suggested: string|null, ranked: object[] }}
 */
export function suggestAssignee(caregivers, schedule, targetTask, opts = {}) {
  const { burnoutThresholdWeeks = 3 } = opts
  const active = (schedule || []).filter((t) => t && t.assignedTo && t.assignedTo !== 'Unassigned')

  // silentLoadEngine: derive week-by-week history, treating same-titled tasks as the same "shift".
  const history = active.map((t) => ({
    assignedTo: t.assignedTo,
    shiftId: t.title,
    weekNumber: weekIndex(t.date),
  }))
  const burntOut = new Set(
    checkSilentLoad(history, burnoutThresholdWeeks).map((w) => w.assignedTo)
  )

  const ranked = (caregivers || []).map((cg) => {
    const name = cg.name
    const baseLoad = active.filter((t) => t.assignedTo === name).length

    // workloadManager: would giving this caregiver the target task overload them?
    const evalResult = evaluateCaregiverWorkload(active, { ...targetTask, assignedTo: name })
    const needsRest = !!evalResult.metadata.needsRest
    const moderate = !needsRest && evalResult.warnings.length > 0
    const burnout = burntOut.has(name)

    const score =
      baseLoad +
      (needsRest ? NEEDS_REST_PENALTY : 0) +
      (moderate ? MODERATE_LOAD_PENALTY : 0) +
      (burnout ? BURNOUT_PENALTY : 0)

    const tiebreak = hashString(`${targetTask?.id ?? ''}:${name}`)
    return { name, score, baseLoad, needsRest, moderate, burnout, tiebreak }
  })

  ranked.sort((a, b) => a.score - b.score || a.tiebreak - b.tiebreak)

  return { suggested: ranked.length ? ranked[0].name : null, ranked }
}
