import { getTasks, updateTask, createTask } from './backend/crud.js';

export async function handleRecurringTaskAction(taskId, actionType, targetDate, newAssignee = null) {
  // Fetch current task structure from Supabase[cite: 4]
  const { data: tasks, error } = await getTasks();
  if (error) throw new Error("Failed to fetch tasks from database.");

  const parentTask = tasks.find(t => t.id === taskId);
  if (!parentTask) throw new Error("Task not found in database.");

  if (actionType === 'skip_once') {
    // Skip only this specific date instance without altering future schedule templates
    const skipInstance = {
      title: parentTask.title,
      category: parentTask.category,
      date: targetDate,
      time: parentTask.time,
      assignee: 'Skipped',
      status: 'skipped',
      priority: parentTask.priority
    };
    console.log(`⏭️ Skipping task '${parentTask.title}' for date ${targetDate}`);
    return await createTask(skipInstance);
  } 
  
  if (actionType === 'permanent_reassign') {
    // Permanently update the assignee for this task line in Supabase[cite: 4]
    console.log(`🔄 Permanently reassigning '${parentTask.title}' to ${newAssignee}`);
    return await updateTask(taskId, { assignee: newAssignee });
  }

  throw new Error("Invalid action type specified.");
}