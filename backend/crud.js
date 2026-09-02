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

export async function findUserByName(name) {
  if (!name || name.toLowerCase() === 'unassigned') return null

  const { data, error } = await supabase
    .from('users')
    .select('id, name')
    .ilike('name', name)

  if (error || !data || data.length !== 1) {
    return null
  }

  return data[0].id
}