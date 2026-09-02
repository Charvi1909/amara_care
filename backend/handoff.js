import { supabase } from './supabaseClient.js'

// Step 1: find candidates and create a handoff request
export async function requestHandoff(taskId, requestedBy) {
  // get all users except the person requesting handoff
  const { data: users, error: userError } = await supabase
    .from('users')
    .select('id')
    .neq('id', requestedBy)

  if (userError) {
    console.log('Error fetching candidates:', userError)
    return { error: userError }
  }

  const candidateIds = users.map(u => u.id)

  // create the handoff request
  const { data, error } = await supabase
    .from('handoff_requests')
    .insert([{
      task_id: taskId,
      requested_by: requestedBy,
      candidate_ids: candidateIds,
      status: 'pending'
    }])
    .select()

  if (error) {
    console.log('Error creating handoff request:', error)
    return { error }
  }

  // update the task status so everyone sees it needs coverage
  await supabase
    .from('tasks')
    .update({ status: 'handoff_requested' })
    .eq('id', taskId)

  console.log('Handoff requested:', data)
  return { data }
}

// Step 2: someone accepts the handoff
export async function acceptHandoff(handoffId, userId, taskId) {
  const { data, error } = await supabase
    .from('handoff_requests')
    .update({ status: 'accepted' })
    .eq('id', handoffId)
    .select()

  if (error) {
    console.log('Error accepting handoff:', error)
    return { error }
  }

  // reassign the task to the person who accepted
  await supabase
    .from('tasks')
    .update({ assigned_to: userId, status: 'confirmed' })
    .eq('id', taskId)

  console.log('Handoff accepted, task reassigned:', data)
  return { data }
}

// Step 3: check for handoff requests that timed out
export async function checkHandoffTimeouts(timeoutMinutes = 60) {
  const cutoff = new Date(Date.now() - timeoutMinutes * 60000).toISOString()

  const { data: expired, error } = await supabase
    .from('handoff_requests')
    .select('*')
    .eq('status', 'pending')
    .lt('created_at', cutoff)

  if (error) {
    console.log('Error checking timeouts:', error)
    return { error }
  }

  for (const request of expired) {
    await supabase
      .from('handoff_requests')
      .update({ status: 'timed_out' })
      .eq('id', request.id)

    await supabase
      .from('tasks')
      .update({ status: 'uncovered_urgent' })
      .eq('id', request.task_id)
  }

  console.log(`${expired.length} handoff request(s) timed out and escalated`)
  return { expired }
}