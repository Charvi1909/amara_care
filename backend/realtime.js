import { supabase } from './supabaseClient.js'

export function subscribeToTasks(onChange) {
  const channel = supabase
    .channel('tasks-changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, (payload) => {
      console.log('Change received:', payload)
      onChange(payload)
    })
    .subscribe()
  return channel
}