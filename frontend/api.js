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

/* ----------------------- auth + family scoping --------------------- *
 *  Hackathon-simple multi-family: no RLS. Every task/user query below
 *  is filtered by the logged-in user's family_id, held here.
 * ---------------------------------------------------------------- */

let currentFamilyId = null

export function getFamilyId() {
  return currentFamilyId
}

export async function getSession() {
  const { data } = await supabase.auth.getSession()
  return data.session
}

// The public.users row for the logged-in auth user (or null).
export async function getMyProfile() {
  const session = await getSession()
  if (!session) return null
  const { data, error } = await supabase
    .from('users')
    .select('id, name, role, family_id, auth_id')
    .eq('auth_id', session.user.id)
    .maybeSingle()
  if (error) {
    console.error('getMyProfile:', error)
    return null
  }
  return data
}

// Call once on page load. Returns { session, profile } or null when the
// visitor is not logged in / has no family (caller should redirect to login).
export async function initFamilyContext() {
  const session = await getSession()
  if (!session) return null
  const profile = await getMyProfile()
  if (!profile || !profile.family_id) return null
  currentFamilyId = profile.family_id
  return { session, profile }
}

export async function getFamily(familyId = currentFamilyId) {
  if (!familyId) return null
  const { data, error } = await supabase
    .from('families')
    .select('id, name, invite_code')
    .eq('id', familyId)
    .maybeSingle()
  if (error) {
    console.error('getFamily:', error)
    return null
  }
  return data
}

export async function getFamilyMembers(familyId = currentFamilyId) {
  if (!familyId) return []
  const { data, error } = await supabase
    .from('users')
    .select('id, name, role, auth_id')
    .eq('family_id', familyId)
    .order('name')
  if (error) {
    console.error('getFamilyMembers:', error)
    return []
  }
  return data
}

/* --- dependents: the people the family provides care for --- */

let dependentsById = new Map()

export async function getDependents(familyId = currentFamilyId) {
  if (!familyId) return []
  const { data, error } = await supabase
    .from('dependents')
    .select('id, name, relation')
    .eq('family_id', familyId)
    .order('created_at')
  if (error) {
    console.error('getDependents:', error)
    return []
  }
  dependentsById = new Map(data.map((d) => [d.id, d]))
  return data
}

export function dependentName(id) {
  if (!id) return null
  return dependentsById.get(id)?.name ?? null
}

export async function addDependent(name, relation) {
  if (!currentFamilyId) return { error: new Error('No family context.') }
  const { data, error } = await supabase
    .from('dependents')
    .insert([{ family_id: currentFamilyId, name: (name || '').trim(), relation: (relation || '').trim() || null }])
    .select()
    .single()
  return { data, error }
}

export async function removeDependent(id) {
  let q = supabase.from('dependents').delete().eq('id', id)
  if (currentFamilyId) q = q.eq('family_id', currentFamilyId)
  const { error } = await q
  return { error }
}

// Detach a member from the family; unassign their tasks so the board
// doesn't show a phantom assignee.
export async function removeFamilyMember(userId) {
  if (currentFamilyId) {
    await supabase
      .from('tasks')
      .update({ assigned_to: null })
      .eq('assigned_to', userId)
      .eq('family_id', currentFamilyId)
  }
  const { error } = await supabase.from('users').update({ family_id: null }).eq('id', userId)
  return { error }
}

function randomInviteCode() {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789' // no ambiguous 0/O/1/I/L
  let code = ''
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)]
  return code
}

export async function signIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) return { error }
  const profile = await getMyProfile()
  if (!profile || !profile.family_id) {
    return {
      error: new Error(
        'This account is not linked to a family yet. Switch to the "Sign up" tab and submit with this same email and password to finish setup.'
      ),
    }
  }
  currentFamilyId = profile.family_id
  return { profile }
}

export async function signOut() {
  currentFamilyId = null
  return supabase.auth.signOut()
}

/**
 * Sign up: create the auth user, then either create a new family (random
 * invite code) or join an existing one by code, then create the linked
 * public.users row.
 * @param {{name,email,password,mode:'create'|'join',familyName?,inviteCode?}} opts
 */
export async function signUp({ name, email, password, mode, familyName, inviteCode, dependentName }) {
  let session = null
  let authId = null

  const { data: authData, error: authErr } = await supabase.auth.signUp({ email, password })
  if (authErr) {
    // Account already exists — e.g. a previous signup that failed before it
    // created the family/profile. Sign in and finish the linking below.
    if (/already registered|already exists|already been registered/i.test(authErr.message)) {
      const { data: si, error: siErr } = await supabase.auth.signInWithPassword({ email, password })
      if (siErr) {
        return { error: new Error('That email is already registered. Use the "Log in" tab — or the password is wrong.') }
      }
      session = si.session
      authId = si.user.id
    } else {
      return { error: authErr }
    }
  } else {
    if (!authData.user) return { error: new Error('Signup failed — no user returned.') }
    session = authData.session
    authId = authData.user.id
  }

  if (!session) {
    return {
      error: new Error(
        'Email confirmation is still enabled for this project. Turn off "Confirm email" in Supabase Auth settings.'
      ),
    }
  }

  // Already linked to a family? Nothing more to do.
  const { data: existing } = await supabase
    .from('users')
    .select('id, name, role, family_id, auth_id')
    .eq('auth_id', authId)
    .maybeSingle()
  if (existing && existing.family_id) {
    currentFamilyId = existing.family_id
    return { profile: existing }
  }

  let family
  if (mode === 'create') {
    for (let attempt = 0; attempt < 5 && !family; attempt++) {
      const { data, error } = await supabase
        .from('families')
        .insert([{ name: familyName || `${name}'s family`, invite_code: randomInviteCode() }])
        .select()
        .single()
      if (!error) family = data
      else if (error.code !== '23505') return { error } // 23505 = unique violation → retry
    }
    if (!family) return { error: new Error('Could not generate a unique invite code. Try again.') }
    currentFamilyId = family.id
    if (dependentName && dependentName.trim()) {
      await addDependent(dependentName, null) // best effort; can also be added later in settings
    }
  } else {
    const code = (inviteCode || '').trim().toUpperCase()
    const { data, error } = await supabase
      .from('families')
      .select('id, name, invite_code')
      .eq('invite_code', code)
      .maybeSingle()
    if (error) return { error }
    if (!data) return { error: new Error(`No family found for invite code "${code}".`) }
    family = data
  }

  // Create the profile row — or repair one that exists but has no family.
  let profile
  if (existing) {
    const { data, error } = await supabase
      .from('users')
      .update({ name, family_id: family.id })
      .eq('id', existing.id)
      .select()
      .single()
    if (error) return { error }
    profile = data
  } else {
    const { data, error } = await supabase
      .from('users')
      .insert([{ name, role: 'caregiver', family_id: family.id, auth_id: authId }])
      .select()
      .single()
    if (error) return { error }
    profile = data
  }

  currentFamilyId = family.id
  return { profile, family }
}

/* ------------------------------ users ------------------------------ */

let usersById = new Map()
let usersByName = new Map()

export async function loadUsers() {
  if (!currentFamilyId) {
    console.warn('loadUsers called with no family context')
    return []
  }
  const { data, error } = await supabase
    .from('users')
    .select('id, name, role, family_id')
    .eq('family_id', currentFamilyId)
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
    dependent: dependentName(row.dependent_id), // display name or null
    // Raw DB values, kept for engines/checks that need the exact stored data.
    _date: row.date,
    _time: row.time,
    _status: row.status,
    _dependentId: row.dependent_id ?? null,
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
  if (!currentFamilyId) return { data: [], error: null }
  const { data, error } = await supabase
    .from('tasks')
    .select('*')
    .eq('family_id', currentFamilyId)
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
    family_id: currentFamilyId,
  }
  if (HAS_CATEGORY_PRIORITY) {
    row.category = uiTask.category || 'general'
    row.priority = uiTask.priority || 'medium'
  }
  if (uiTask.dependentId) row.dependent_id = uiTask.dependentId

  let { data, error } = await supabase.from('tasks').insert([row]).select()
  // Self-heal if migration 004 (tasks.dependent_id) has not been applied yet.
  if (error && 'dependent_id' in row && /dependent_id/.test(error.message || '')) {
    delete row.dependent_id
    ;({ data, error } = await supabase.from('tasks').insert([row]).select())
  }
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

  let q = supabase.from('tasks').update(patch).eq('id', id)
  if (currentFamilyId) q = q.eq('family_id', currentFamilyId) // defence in depth
  const { data, error } = await q.select()
  if (error) {
    console.error('Error updating task:', error)
    return { data: null, error }
  }
  return { data: data.map(rowToTask), error: null }
}

export async function deleteTask(id) {
  let q = supabase.from('tasks').delete().eq('id', id)
  if (currentFamilyId) q = q.eq('family_id', currentFamilyId)
  const { error } = await q
  if (error) {
    console.error('Error deleting task:', error)
    return { error }
  }
  return { error: null }
}

/* ----------------------------- realtime --------------------------- */

export function subscribeToTasks(onChange) {
  const opts = { event: '*', schema: 'public', table: 'tasks' }
  if (currentFamilyId) opts.filter = `family_id=eq.${currentFamilyId}`
  return supabase.channel('tasks-changes').on('postgres_changes', opts, onChange).subscribe()
}
