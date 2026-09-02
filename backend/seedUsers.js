import { supabase } from './supabaseClient.js'

export async function createUser(name, role) {
  const { data, error } = await supabase
    .from('users')
    .insert([{ name, role }])
    .select()

  if (error) {
    console.log('Error creating user:', error)
  } else {
    console.log('User created:', data)
  }
  return { data, error }
}