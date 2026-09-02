// Workload, Rest Status, and Review-and-Confirm Formatter

function evaluateCaregiverWorkload(existingSchedule, proposedTaskOrShift) {
  let warnings = [];
  let caregiverLoad = {};

  // 1. Calculate recent shift density (double/triple shifts in a short window)
  const proposedDate = new Date(proposedTaskOrShift.date);
  const assignedPerson = proposedTaskOrShift.assignedTo;

  let shiftsInWindow = existingSchedule.filter(task => {
    if (task.assignedTo !== assignedPerson) return false;
    const taskDate = new Date(task.date);
    const diffHours = Math.abs(proposedDate - taskDate) / (1000 * 60 * 60);
    // Check shifts within a 48-hour rolling window
    return diffHours <= 48;
  });

  // Include the proposed task/shift in the count check
  const totalUpcoming = shiftsInWindow.length + 1;

  let restStatus = {
    assignedTo: assignedPerson,
    needsRest: false,
    recommendationPenalty: false,
    message: ""
  };

  if (totalUpcoming >= 3) {
    restStatus.needsRest = true;
    restStatus.recommendationPenalty = true;
    restStatus.message = `🛑 High Burnout Risk: ${assignedPerson} is slated for ${totalUpcoming} shifts within 48 hours. Flagged as 'needs_rest' and deprioritized for new assignments.`;
    warnings.push(restStatus);
  } else if (totalUpcoming === 2) {
    restStatus.message = `⚠️ Moderate Load: ${assignedPerson} has back-to-back commitments. Proceed with caution.`;
    warnings.push(restStatus);
  }

  // 2. Format into the Review-and-Confirm payload expected by Person C's UI
  const reviewAndConfirmPayload = {
    id: proposedTaskOrShift.id || "task_" + Math.random().toString(36).substring(2, 8),
    title: proposedTaskOrShift.title,
    assignedTo: assignedPerson,
    date: proposedTaskOrShift.date,
    time: proposedTaskOrShift.time,
    status: "pending_user_approval", // Gives the user the final choice
    warnings: warnings,
    metadata: {
      needsRest: restStatus.needsRest,
      requiresOverrideToConfirm: restStatus.needsRest
    },
    actions: {
      approve: "POST /api/tasks/confirm",
      overrideAndReassign: "POST /api/tasks/reassign",
      skip: "POST /api/tasks/skip"
    }
  };

  return reviewAndConfirmPayload;
}

export { evaluateCaregiverWorkload };