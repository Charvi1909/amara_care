// A simple conflict detection rule engine for the team's data model

function checkScheduleConflicts(existingTasks, newTask) {
  let conflicts = [];

  const newStart = new Date(`${newTask.date}T${newTask.time}`);
  // Assuming a default 1-hour duration if end time isn't explicitly provided
  const newEnd = new Date(newStart.getTime() + 60 * 60 * 1000); 

  for (const task of existingTasks) {
    // Only check tasks assigned to the same person on the same day
    if (task.assignedTo === newTask.assignedTo && task.date === newTask.date) {
      const existingStart = new Date(`${task.date}T${task.time}`);
      const existingEnd = new Date(existingStart.getTime() + 60 * 60 * 1000);

      // Check for time overlap
      if (newStart < existingEnd && newEnd > existingStart) {
        conflicts.push({
          conflictWith: task.title,
          assignedTo: task.assignedTo,
          message: `Overlap detected! '${newTask.title}' clashes with '${task.title}' for ${task.assignedTo}.`
        });
      }
    }
  }

  return conflicts;
}

// --- TEST THE CONFLICT ENGINE ---
const mockExistingSchedule = [
  {
    id: "task_01",
    title: "Doctor Appointment",
    assignedTo: "Sarah",
    date: "2026-06-06",
    time: "15:00",
    status: "confirmed"
  }
];

const newlyExtractedTask = {
  id: "task_02",
  title: "Grab Mom from Dialysis",
  assignedTo: "Sarah",
  date: "2026-06-06",
  time: "15:30",
  status: "pending_confirmation"
};

const foundConflicts = checkScheduleConflicts(mockExistingSchedule, newlyExtractedTask);
console.log("🔍 Conflict Check Results:", foundConflicts);