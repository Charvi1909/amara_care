import { supabase } from './supabaseClient.js'

export async function createTask(task) {
  const { data, error } = await supabase.from('tasks').insert([task]).select()
  if (error) {
    console.log('Error creating task:', error)
  } else {
    console.log('Task created:', data)
  }
  return { data, error }
}

export async function getTasks() {
  const { data, error } = await supabase.from('tasks').select()
  if (error) {
    console.log('Error fetching tasks:', error)
  } else {
    console.log('Tasks:', data)
  }
  return { data, error }
}

export async function updateTask(id, updates) {
  const { data, error } = await supabase.from('tasks').update(updates).eq('id', id).select()
  if (error) {
    console.log('Error updating task:', error)
  } else {
    console.log('Task updated:', data)
  }
  return { data, error }
}

export async function deleteTask(id) {
  const { data, error } = await supabase.from('tasks').delete().eq('id', id)
  if (error) {
    console.log('Error deleting task:', error)
  } else {
    console.log('Task deleted')
  }
  return { data, error }
}

// Resolve a name to a user id (case-insensitive). Returns the id, or null for
// "unassigned" / no match / an ambiguous match. Pass familyId to only match
// members of that family. Callers use the id directly as `assigned_to`.
export async function findUserByName(name, familyId = null) {
  if (!name || name.toLowerCase() === 'unassigned') return null

  let q = supabase.from('users').select('id, name').ilike('name', name)
  if (familyId) q = q.eq('family_id', familyId)
  const { data, error } = await q

  if (error) console.log('Error finding user:', error)
  if (error || !data || data.length !== 1) return null

  return data[0].id
}

// All members of a family — used to match AI-extracted assignee names.
export async function getFamilyUsers(familyId) {
  if (!familyId) return { data: [], error: null }
  const { data, error } = await supabase
    .from('users')
    .select('id, name')
    .eq('family_id', familyId)
  if (error) console.log('Error fetching family users:', error)
  return { data: data || [], error }
}