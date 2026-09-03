import { supabase } from './supabaseClient.js'
// Vendored copy of backend/suggestionEngine.mjs (+ its two engine deps) so the
// frontend can be served standalone. Source of truth is backend/; re-sync with
// `npm run sync:engine`.
import { suggestAssignee as _suggestAssignee } from './engine/suggestionEngine.mjs'
import { checkScheduleConflicts } from './engine/conflictEngine.mjs'
import { findDuplicateTask } from './engine/taskMatch.mjs'

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
let currentUserId = null

export function getFamilyId() {
  return currentFamilyId
}

export function getUserId() {
  return currentUserId
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
  currentUserId = profile.id
  return { session, profile }
}

export async function getFamily(familyId = currentFamilyId) {
  if (!familyId) return null
  const { data, error } = await supabase
    .from('families')
    .select('id, name, invite_code, emergency_contact_name, emergency_contact_info')
    .eq('id', familyId)
    .maybeSingle()
  if (error) {
    console.error('getFamily:', error)
    return null
  }
  return data
}

// Update family name / emergency contact (any member can).
export async function updateFamily(patch) {
  if (!currentFamilyId) return { error: new Error('No family.') }
  const allowed = {}
  if ('name' in patch && patch.name) allowed.name = patch.name.trim()
  if ('emergencyName' in patch) allowed.emergency_contact_name = (patch.emergencyName || '').trim() || null
  if ('emergencyInfo' in patch) allowed.emergency_contact_info = (patch.emergencyInfo || '').trim() || null
  const { error } = await supabase.from('families').update(allowed).eq('id', currentFamilyId)
  return { error }
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
  currentUserId = profile.id
  return { profile }
}

export async function signOut() {
  currentFamilyId = null
  currentUserId = null
  return supabase.auth.signOut()
}

/**
 * Sign up: create the auth user, then either create a new family (random
 * invite code) or join an existing one by code, then create the linked
 * public.users row.
 * @param {{name,email,password,mode:'create'|'join',familyName?,inviteCode?}} opts
 */
export async function signUp({ name, email, password, mode, familyName, inviteCode, dependentName, emergencyName, emergencyInfo }) {
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
        .insert([{
          name: familyName || `${name}'s family`,
          invite_code: randomInviteCode(),
          emergency_contact_name: (emergencyName || '').trim() || null,
          emergency_contact_info: (emergencyInfo || '').trim() || null,
        }])
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
  // `email` self-heals if migration 009 hasn't been applied yet.
  const cleanEmail = (email || '').trim().toLowerCase() || null
  const missingEmailCol = (e) => e && /email/.test(e.message || '') && /column|schema/i.test(e.message || '')

  async function writeProfile(withEmail) {
    const base = { name, family_id: family.id, ...(withEmail ? { email: cleanEmail } : {}) }
    return existing
      ? supabase.from('users').update(base).eq('id', existing.id).select().single()
      : supabase.from('users').insert([{ role: 'caregiver', auth_id: authId, ...base }]).select().single()
  }

  let { data: profile, error: profErr } = await writeProfile(true)
  if (missingEmailCol(profErr)) ({ data: profile, error: profErr } = await writeProfile(false))
  if (profErr) return { error: profErr }

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
    .select('id, name, role, family_id, auth_id')
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

// "15:00" / "15:00:00" -> "03:00 PM". A null/empty time means the task has no
// fixed slot ("any time that day") — never invent a clock time for it.
export function formatTime(t) {
  if (!t) return 'Any time'
  let [h, m] = String(t).split(':').map(Number)
  const ampm = h >= 12 ? 'PM' : 'AM'
  h = h % 12 || 12
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')} ${ampm}`
}

// Accepts "15:00", "15:00:00" or "03:00 PM". Empty -> null: the task has no
// fixed time. Persisting a fake "12:00:00" here is what used to make timeless
// tasks look timed (wrong escalation path, phantom conflicts, false "past due").
function uiTimeToDb(t) {
  if (!t) return null
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
    _recurring: !!row.recurring,
    _assignedTo: row.assigned_to ?? null,
    _emergencyAlertedAt: row.emergency_alerted_at ?? null,
    _emergencyAckedAt: row.emergency_acked_at ?? null,
    _emergencyFinalAt: row.emergency_final_at ?? null,
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

/* ------------------- scheduling conflict checks ------------------- */

// Does (assigneeName, dateISO, timeStr) overlap another task the same person
// already has? Uses conflictEngine (60-min default slots). Timeless tasks have
// no fixed slot, so they neither cause nor receive a conflict. Returns the
// conflicting UI task (or null).
export function findConflict(assigneeName, dateISO, timeStr, allUiTasks, excludeId = null) {
  const time = String(timeStr || '').slice(0, 5)
  if (!assigneeName || assigneeName === 'Unassigned' || !dateISO || !time) return null

  const existing = (allUiTasks || [])
    .filter(
      (t) =>
        t.id !== excludeId &&
        t.status !== 'done' &&
        t.assignee === assigneeName &&
        t._date === dateISO &&
        String(t._time || '').slice(0, 5)
    )
    .map((t) => ({ id: t.id, title: t.title, date: t._date, time: String(t._time).slice(0, 5), assignedTo: assigneeName }))

  const hits = checkScheduleConflicts(existing, { title: 'this task', date: dateISO, time, assignedTo: assigneeName })
  if (hits.length === 0) return null
  return (allUiTasks || []).find((t) => t.id === hits[0].conflictingTaskId) || null
}

// Claim atomically: only succeeds while the task is still unassigned.
export async function claimTask(taskId, assigneeName) {
  const uid = nameToId(assigneeName)
  let q = supabase
    .from('tasks')
    .update({ assigned_to: uid, status: uiStatusToDb('pending') })
    .eq('id', taskId)
    .is('assigned_to', null)
  if (currentFamilyId) q = q.eq('family_id', currentFamilyId)
  const { data, error } = await q.select()
  if (error) return { error }
  if (!data || data.length === 0) return { taken: true } // someone else got there first
  return { data: data.map(rowToTask) }
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

export function subscribeToFamilyActivity(onChange) {
  if (!currentFamilyId) return null
  return supabase
    .channel('family-activity')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'handoff_requests', filter: `family_id=eq.${currentFamilyId}` }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'task_proposals', filter: `family_id=eq.${currentFamilyId}` }, onChange)
    .subscribe()
}

/* ---------------------- handoff (ask family to cover) -------------- */

// Members who can actually respond = family members with a login.
async function activeMembers() {
  const { data } = await supabase
    .from('users').select('id, name, auth_id').eq('family_id', currentFamilyId)
  return (data || []).filter((u) => u.auth_id)
}

export async function requestHandoff(taskId) {
  if (!currentFamilyId || !currentUserId) return { error: new Error('Not signed in.') }
  const members = await activeMembers()
  const candidates = members.filter((m) => m.id !== currentUserId).map((m) => m.id)
  if (candidates.length === 0) return { error: new Error('No one else in the family can cover this yet.') }

  const { error } = await supabase.from('handoff_requests').insert([{
    task_id: taskId, family_id: currentFamilyId, requested_by: currentUserId,
    candidate_ids: candidates, declined_by: [], status: 'pending',
  }])
  if (error) return { error }
  await supabase.from('tasks').update({ status: 'handoff_requested' }).eq('id', taskId)
  return { error: null }
}

// Pending requests where I'm a candidate and haven't answered.
export async function getIncomingHandoffs() {
  if (!currentFamilyId || !currentUserId) return []
  const { data, error } = await supabase
    .from('handoff_requests')
    .select('id, task_id, requested_by, candidate_ids, declined_by, status')
    .eq('family_id', currentFamilyId)
    .eq('status', 'pending')
  if (error) { console.error('getIncomingHandoffs:', error); return [] }
  return (data || []).filter(
    (h) => (h.candidate_ids || []).includes(currentUserId) && !(h.declined_by || []).includes(currentUserId)
  )
}

export async function acceptHandoff(handoffId, taskId) {
  const upd = await supabase.from('handoff_requests').update({ status: 'accepted' }).eq('id', handoffId).eq('status', 'pending').select()
  if (upd.error) return { error: upd.error }
  if (!upd.data || upd.data.length === 0) return { error: new Error('This request was already handled.') }
  const { error } = await supabase.from('tasks').update({ assigned_to: currentUserId, status: 'confirmed' }).eq('id', taskId)
  return { error }
}

export async function declineHandoff(handoffId, taskId) {
  const { data: row, error } = await supabase
    .from('handoff_requests').select('candidate_ids, declined_by').eq('id', handoffId).maybeSingle()
  if (error || !row) return { error: error || new Error('Request not found.') }
  const declined = Array.from(new Set([...(row.declined_by || []), currentUserId]))
  const everyoneDeclined = (row.candidate_ids || []).every((id) => declined.includes(id))

  await supabase.from('handoff_requests')
    .update({ declined_by: declined, status: everyoneDeclined ? 'declined' : 'pending' })
    .eq('id', handoffId)

  if (everyoneDeclined) {
    await supabase.from('tasks').update({ assigned_to: null, status: 'uncovered_urgent' }).eq('id', taskId)
  }
  return { error: null, everyoneDeclined }
}

/* ------------------- emergency escalation ------------------------- */

export const ESCALATION_WINDOW_MIN = 60
export const FINAL_TIER_SEC = 60 // no ack within this -> highest-urgency tier

// Escalate to the highest-urgency tier: the emergency contact was alerted but
// hasn't acknowledged within FINAL_TIER_SEC and the task is still uncovered.
// Guarded so it stamps once and never overrides an acknowledgment.
export async function markEmergencyFinal(taskId) {
  const { data } = await supabase
    .from('tasks')
    .update({ emergency_final_at: new Date().toISOString() })
    .eq('id', taskId)
    .is('emergency_final_at', null)
    .is('emergency_acked_at', null)
    .select()
  return { escalated: !!(data && data.length) }
}

// Is the task at its escalation point?
//  - has a time  -> deadline within ESCALATION_WINDOW_MIN minutes (or past).
//                   These escalate straight to email (no time for a vote).
//  - no time     -> HIGH priority AND due today or overdue. These go to a
//                   family vote first (there's more slack in the day).
export function deadlineImminent(dateISO, timeStr, priority) {
  if (!dateISO) return false
  const t = parseTime(timeStr)
  if (!t) return priority === 'high' && String(dateISO) <= todayISO()
  const [y, m, d] = String(dateISO).split('-').map(Number)
  const deadline = new Date(y, m - 1, d, t.h, t.m, 0, 0).getTime()
  return deadline <= Date.now() + ESCALATION_WINDOW_MIN * 60000
}

// Close any open "escalate" vote whose task is no longer an emergency
// (it got claimed, reassigned via handoff, rescheduled out of the window,
// deleted, or already alerted). Keeps the Family Decisions banner honest.
export async function closeStaleEscalations(uiTasks) {
  if (!currentFamilyId) return
  const { data: props } = await supabase
    .from('task_proposals')
    .select('id, task_id')
    .eq('family_id', currentFamilyId)
    .eq('kind', 'escalate')
    .eq('status', 'open')
  if (!props || props.length === 0) return
  const byId = Object.fromEntries((uiTasks || []).map((t) => [t.id, t]))
  for (const p of props) {
    const t = byId[p.task_id]
    const stillEmergency =
      t &&
      t._status === 'uncovered_urgent' &&
      !t._assignedTo &&
      !t._emergencyAlertedAt &&
      deadlineImminent(t._date, t._time, t.priority)
    if (!stillEmergency) {
      await supabase.from('task_proposals').update({ status: 'cancelled' }).eq('id', p.id)
    }
  }
}

// Tasks that need a family vote to escalate: uncovered_urgent, unassigned, not
// already alerted, deadline imminent, and no handoff request still live.
export async function findEmergencyTasks(uiTasks) {
  const candidates = (uiTasks || []).filter(
    (t) =>
      t._status === 'uncovered_urgent' &&
      !t._assignedTo &&
      !t._emergencyAlertedAt &&
      deadlineImminent(t._date, t._time, t.priority)
  )
  if (candidates.length === 0) return []

  const ids = candidates.map((t) => t.id)
  const { data: hos } = await supabase
    .from('handoff_requests')
    .select('task_id, status')
    .in('task_id', ids)
  const liveByTask = new Set(
    (hos || []).filter((h) => h.status === 'pending' || h.status === 'accepted').map((h) => h.task_id)
  )
  return candidates.filter((t) => !liveByTask.has(t.id))
}

// Ask the server to escalate: it re-checks, emails the family's emergency
// contact via Resend, and stamps tasks.emergency_alerted_at.
export async function escalateEmergency(taskId) {
  try {
    const res = await fetch('/api/emergency-alert', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        taskId,
        familyId: currentFamilyId,
        // The server may run in any timezone (localhost, a UTC cloud box). Send
        // our clock so its "due today / within the hour" re-check matches what
        // the user actually sees. Task times are wall-clock in this timezone.
        clientToday: todayISO(),
        clientNowMs: Date.now(),
        tzOffsetMin: new Date().getTimezoneOffset(),
      }),
    })
    return await res.json() // { alerted, alreadyAlerted, emailSent, emailError, contact }
  } catch (err) {
    return { alerted: false, error: err.message }
  }
}

/* --------------------- proposals (family vote) -------------------- */

// Reschedule "window" -> a concrete date. Time is cleared (any time that day).
export function windowToDate(win) {
  const d = new Date()
  const add = (n) => { const x = new Date(); x.setDate(x.getDate() + n); return toISODate(x) }
  switch (win) {
    case 'today': return todayISO()
    case 'tomorrow': return add(1)
    case 'this_week': return add((6 - d.getDay() + 7) % 7)          // Saturday of this week
    case 'next_week': return add(((6 - d.getDay() + 7) % 7) + 7)    // Saturday next week
    case 'this_month': return toISODate(new Date(d.getFullYear(), d.getMonth() + 1, 0))
    default: return todayISO()
  }
}

export async function createProposal({ taskId, kind, newDate = null, newWindow = null }) {
  if (!currentFamilyId || !currentUserId) return { error: new Error('Not signed in.') }
  const { error } = await supabase.from('task_proposals').insert([{
    family_id: currentFamilyId, task_id: taskId, proposed_by: currentUserId,
    kind, new_date: newDate, new_window: newWindow,
    votes: { [currentUserId]: 'approve' }, status: 'open',
  }])
  return { error }
}

// System-raised "should we alert the emergency contact?" vote. One open
// escalate proposal per task; starts with NO votes (the family decides).
export async function proposeEscalation(taskId) {
  if (!currentFamilyId || !currentUserId) return { error: new Error('Not signed in.') }
  const { data: open } = await supabase
    .from('task_proposals').select('id')
    .eq('family_id', currentFamilyId).eq('task_id', taskId)
    .eq('kind', 'escalate').eq('status', 'open')
  if (open && open.length) return { error: null, existed: true }
  const { error } = await supabase.from('task_proposals').insert([{
    family_id: currentFamilyId, task_id: taskId, proposed_by: currentUserId,
    kind: 'escalate', votes: {}, status: 'open',
  }])
  return { error }
}

export async function getOpenProposals() {
  if (!currentFamilyId) return []
  const { data, error } = await supabase
    .from('task_proposals').select('*').eq('family_id', currentFamilyId).eq('status', 'open')
    .order('created_at', { ascending: false })
  if (error) { console.error('getOpenProposals:', error); return [] }
  return data || []
}

export async function cancelProposal(id) {
  const { error } = await supabase.from('task_proposals').update({ status: 'cancelled' }).eq('id', id).eq('proposed_by', currentUserId)
  return { error }
}

// Cast a vote; if approvals reach a majority of logged-in members, execute it.
export async function voteProposal(id, vote) {
  const { data: p, error } = await supabase.from('task_proposals').select('*').eq('id', id).maybeSingle()
  if (error || !p || p.status !== 'open') return { error: error || new Error('Proposal is closed.') }

  const votes = { ...(p.votes || {}), [currentUserId]: vote }
  const members = await activeMembers()
  const total = members.length || 1
  const approvals = Object.values(votes).filter((v) => v === 'approve').length
  const rejections = Object.values(votes).filter((v) => v === 'reject').length
  const majority = Math.floor(total / 2) + 1

  let status = 'open'
  if (approvals >= majority) status = 'approved'
  else if (rejections >= majority || (rejections + approvals >= total && approvals < majority)) status = 'rejected'

  await supabase.from('task_proposals').update({ votes, status }).eq('id', id)

  let escalation = null
  let rescheduleConflict = null
  if (status === 'approved') {
    if (p.kind === 'delete') {
      await supabase.from('tasks').delete().eq('id', p.task_id).eq('family_id', currentFamilyId)
    } else if (p.kind === 'reschedule') {
      const newDate = p.new_date || windowToDate(p.new_window)

      // Check the moved task against what the assignee already has, then apply
      // anyway (the family voted) but report the clash. A "window" reschedule
      // clears the time (any time that day), so it can't collide on a slot.
      const { data: fresh } = await supabase.from('tasks').select('*').eq('family_id', currentFamilyId)
      const uiFresh = (fresh || []).map(rowToTask)
      const moved = uiFresh.find((t) => t.id === p.task_id)
      if (moved && moved.assignee !== 'Unassigned' && !p.new_window) {
        const conf = findConflict(moved.assignee, newDate, moved._time, uiFresh, p.task_id)
        if (conf) rescheduleConflict = { title: conf.title, date: conf.date, time: conf.time, who: moved.assignee }
      }

      const patch = { date: newDate }
      if (p.new_window) patch.time = null // "any time that day" — no fixed slot
      await supabase.from('tasks').update(patch).eq('id', p.task_id).eq('family_id', currentFamilyId)
    } else if (p.kind === 'escalate') {
      escalation = await escalateEmergency(p.task_id) // server emails contact + all members
    }
  }
  return { error: null, status, approvals, total, escalation, rescheduleConflict }
}
