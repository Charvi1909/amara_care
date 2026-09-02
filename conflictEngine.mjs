// Enhanced Conflict Detection Engine

function parseDateTime(dateStr, timeStr) {
  return new Date(`${dateStr}T${timeStr}:00`);
}

function checkScheduleConflicts(existingTasks, newTask, defaultDurationMinutes = 60) {
  let conflicts = [];

  // Parse new task start time (and fallback duration if no endTime is provided)
  const newStart = parseDateTime(newTask.date, newTask.time);
  const newEnd = newTask.endTime 
    ? parseDateTime(newTask.date, newTask.endTime) 
    : new Date(newStart.getTime() + defaultDurationMinutes * 60 * 1000);

  for (const task of existingTasks) {
    // Only check tasks assigned to the same person on the same day
    if (task.assignedTo === newTask.assignedTo && task.date === newTask.date) {
      const existingStart = parseDateTime(task.date, task.time);
      const existingEnd = task.endTime 
        ? parseDateTime(task.date, task.endTime) 
        : new Date(existingStart.getTime() + defaultDurationMinutes * 60 * 1000);

      // Standard interval overlap formula: (StartA < EndB) && (EndA > StartB)
      if (newStart < existingEnd && newEnd > existingStart) {
        conflicts.push({
          conflictingTaskId: task.id,
          conflictWith: task.title,
          assignedTo: task.assignedTo,
          message: `⚠️ Schedule overlap: '${newTask.title}' clashes with existing task '${task.title}' for ${task.assignedTo}.`
        });
      }
    }
  }

  return conflicts;
}

export { checkScheduleConflicts };