import { supabase } from './supabaseClient.js'
// Vendored copy of backend/suggestionEngine.mjs (+ its two engine deps) so the
// frontend can be served standalone. Source of truth is backend/; re-sync with
// `npm run sync:engine`.
import { suggestAssignee as _suggestAssignee } from './engine/suggestionEngine.mjs'

/* ------------------------------------------------------------------ *
 *  Data access layer for the frontend.
 *
 *  This is the browser twin of backend/crud.js. It talks to the same
 *  Supabase project, but adds a mapping layer between the shape the UI
 *  works with and the actual `public.tasks` columns.
 *
 *  public.tasks:
 *    id            uuid   (generated)
 *    title         text
 *    assigned_to   uuid   -> public.users.id   (null = "Unassigned")
 *    date          date   "YYYY-MM-DD"
 *    time          time   "HH:MM:SS"
 *    recurring     bool
 *    status        text   pending | confirmed | completed |
 *                         handoff_requested | uncovered_urgent | ...
 *    source        text   "manual" | "ai_extracted"
 *    original_text text
 *
 *  The UI also shows `category` and `priority`, which do NOT exist in
 *  the DB yet. Run backend/migrations/001_add_task_fields.sql, then set
 *  HAS_CATEGORY_PRIORITY to true to persist them.
 * ------------------------------------------------------------------ */

const HAS_CATEGORY_PRIORITY = true

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sept', 'Oct', 'Nov', 'Dec']

/* --------------------------- real "now" --------------------------- *
 *  Every date/time decision in the app derives from the machine clock
 *  via `new Date()`. There is no hardcoded "today" anywhere.
 * ---------------------------------------------------------------- */

// Local-time YYYY-MM-DD for a Date (defaults to right now).
export function toISODate(dt = new Date()) {
  return (
    `${dt.getFullYear()}-` +
    `${String(dt.getMonth() + 1).padStart(2, '0')}-` +
    `${String(dt.getDate()).padStart(2, '0')}`
  )
}

export function todayISO() {
  return toISODate(new Date())
}

// Parse a loose time string ("15:00", "15:00:00", "3:00 PM") -> { h, m } | null.
function parseTime(timeStr) {
  const s = String(timeStr || '')
  const ampm = s.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i)
  if (ampm) {
    let h = Number(ampm[1]) % 12
    if (/PM/i.test(ampm[3])) h += 12
    return { h, m: Number(ampm[2]) }
  }
  const h24 = s.match(/^(\d{1,2}):(\d{2})/)
  if (h24) return { h: Number(h24[1]), m: Number(h24[2]) }
  return null
}

// Is (dateISO, timeStr) strictly earlier than the real current moment?
export function isInPast(dateISO, timeStr) {
  if (!dateISO) return false
  const [y, m, d] = String(dateISO).split('-').map(Number)
  if (!y || !m || !d) return false
  const t = parseTime(timeStr)
  if (!t) return String(dateISO) < todayISO()
  return new Date(y, m - 1, d, t.h, t.m, 0, 0).getTime() < Date.now()
}

/* ------------------------------ users ------------------------------ */

let usersById = new Map()
let usersByName = new Map()

export async function loadUsers() {
  const { data, error } = await supabase.from('users').select('id, name, role')
  if (error) {
    console.error('Error loading users:', error)
    return []
  }
  usersById = new Map(data.map((u) => [u.id, u]))
  usersByName = new Map(data.map((u) => [u.name.toLowerCase(), u]))
  return data
}

export function getUsers() {
  return [...usersById.values()]
}

function nameToId(name) {
  if (!name || name.toLowerCase() === 'unassigned') return null
  return usersByName.get(name.toLowerCase())?.id ?? null
}

function idToName(id) {
  if (!id) return 'Unassigned'
  return usersById.get(id)?.name ?? 'Unassigned'
}

/* -------------------------- value mappers -------------------------- */

// UI task date -> DB `date` column. Canonical form is already YYYY-MM-DD;
// 'Today' and the legacy "Sept 4" label are tolerated as fallbacks.
function uiDateToDb(ui) {
  if (!ui || ui === 'Today') return todayISO()
  if (/^\d{4}-\d{2}-\d{2}$/.test(ui)) return ui
  const [mon, day] = String(ui).split(' ')
  const m = MONTHS.indexOf(mon) + 1
  if (!m || !day) return todayISO()
  const y = new Date().getFullYear()
  return `${y}-${String(m).padStart(2, '0')}-${String(Number(day)).padStart(2, '0')}`
}

// "15:00" / "15:00:00" -> "03:00 PM"
export function formatTime(t) {
  if (!t) return '12:00 PM'
  let [h, m] = String(t).split(':').map(Number)
  const ampm = h >= 12 ? 'PM' : 'AM'
  h = h % 12 || 12
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')} ${ampm}`
}

// Accepts "15:00", "15:00:00" or "03:00 PM".
function uiTimeToDb(t) {
  if (!t) return '12:00:00'
  const ampm = t.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i)
  if (ampm) {
    let h = Number(ampm[1]) % 12
    if (/PM/i.test(ampm[3])) h += 12
    return `${String(h).padStart(2, '0')}:${ampm[2]}:00`
  }
  const [h, m] = t.split(':')
  return `${String(Number(h)).padStart(2, '0')}:${(m ?? '00').padStart(2, '0')}:00`
}

function dbStatusToUi(s) {
  if (s === 'completed' || s === 'done') return 'done'
  if (s === 'handoff_requested' || s === 'uncovered_urgent') return 'conflict'
  return 'pending'
}

function uiStatusToDb(s) {
  if (s === 'done') return 'completed'
  if (s === 'uncovered_urgent') return 'uncovered_urgent' // raw DB status, passed through
  if (s === 'conflict') return 'handoff_requested'
  return 'confirmed'
}

/* ------------------------- row <-> ui task ------------------------- */

function rowToTask(row) {
  return {
    id: row.id,
    date: row.date, // canonical YYYY-MM-DD; UI formats it for display
    time: formatTime(row.time),
    title: row.title,
    category: (HAS_CATEGORY_PRIORITY ? row.category : null) || 'general',
    assignee: idToName(row.assigned_to),
    priority: (HAS_CATEGORY_PRIORITY ? row.priority : null) || 'medium',
    status: dbStatusToUi(row.status),
    // Raw DB values, kept for engines/checks that need the exact stored data.
    _date: row.date,
    _time: row.time,
    _status: row.status,
  }
}

/* ----------------------- assignment suggestion -------------------- */

// Suggests which caregiver should take `uiTask`, using the real workload /
// burnout engines in backend/suggestionEngine.mjs. Returns a name or null.
export function suggestAssignee(uiTask, allUiTasks, caregivers) {
  const schedule = (allUiTasks || [])
    .filter((t) => t.status !== 'done')
    .map((t) => ({
      id: t.id,
      title: t.title,
      assignedTo: t.assignee,
      date: t._date,
      time: (t._time || '').slice(0, 5),
    }))

  const target = {
    id: uiTask.id,
    title: uiTask.title,
    date: uiTask._date,
    time: (uiTask._time || '').slice(0, 5),
  }

  const { suggested } = _suggestAssignee(
    (caregivers || []).map((c) => ({ name: c.name })),
    schedule,
    target
  )
  return suggested
}

/* ------------------------------ CRUD ------------------------------- */

export async function getTasks() {
  const { data, error } = await supabase
    .from('tasks')
    .select('*')
    .order('date', { ascending: true })
    .order('time', { ascending: true })
  if (error) {
    console.error('Error fetching tasks:', error)
    return { data: [], error }
  }
  return { data: data.map(rowToTask), error: null }
}

export async function createTask(uiTask) {
  const row = {
    title: uiTask.title,
    assigned_to: nameToId(uiTask.assignee),
    date: uiDateToDb(uiTask.date),
    time: uiTimeToDb(uiTask.time),
    status: uiStatusToDb(uiTask.status || 'pending'),
    recurring: false,
    source: uiTask.source || 'manual',
  }
  if (HAS_CATEGORY_PRIORITY) {
    row.category = uiTask.category || 'general'
    row.priority = uiTask.priority || 'medium'
  }

  const { data, error } = await supabase.from('tasks').insert([row]).select()
  if (error) {
    console.error('Error creating task:', error)
    return { data: null, error }
  }
  return { data: data.map(rowToTask), error: null }
}

// `uiUpdates` is a partial UI task: { assignee, status, title, date, time, ... }
export async function updateTask(id, uiUpdates) {
  const patch = {}
  if ('assignee' in uiUpdates) patch.assigned_to = nameToId(uiUpdates.assignee)
  if ('status' in uiUpdates) patch.status = uiStatusToDb(uiUpdates.status)
  if ('title' in uiUpdates) patch.title = uiUpdates.title
  if ('date' in uiUpdates) patch.date = uiDateToDb(uiUpdates.date)
  if ('time' in uiUpdates) patch.time = uiTimeToDb(uiUpdates.time)
  if (HAS_CATEGORY_PRIORITY && 'category' in uiUpdates) patch.category = uiUpdates.category
  if (HAS_CATEGORY_PRIORITY && 'priority' in uiUpdates) patch.priority = uiUpdates.priority

  const { data, error } = await supabase.from('tasks').update(patch).eq('id', id).select()
  if (error) {
    console.error('Error updating task:', error)
    return { data: null, error }
  }
  return { data: data.map(rowToTask), error: null }
}

export async function deleteTask(id) {
  const { error } = await supabase.from('tasks').delete().eq('id', id)
  if (error) {
    console.error('Error deleting task:', error)
    return { error }
  }
  return { error: null }
}

/* ----------------------------- realtime --------------------------- */

export function subscribeToTasks(onChange) {
  return supabase
    .channel('tasks-changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, onChange)
    .subscribe()
}
