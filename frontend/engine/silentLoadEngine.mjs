// Predictive Silent-Load Engine for Caregiving Burnout Prevention

function checkSilentLoad(historicalAssignments, thresholdWeeks = 3) {
  let userStreakCounts = {};
  let warnings = [];
  const sorted = historicalAssignments.sort((a, b) => a.weekNumber - b.weekNumber);

  for (const entry of sorted) {
    const key = `${entry.assignedTo}-${entry.shiftId}`;
    
    if (!userStreakCounts[key]) {
      userStreakCounts[key] = {
        assignedTo: entry.assignedTo,
        shiftId: entry.shiftId,
        consecutiveWeeks: 1,
        lastWeek: entry.weekNumber
      };
    } else {
      if (entry.weekNumber === userStreakCounts[key].lastWeek + 1) {
        userStreakCounts[key].consecutiveWeeks += 1;
        userStreakCounts[key].lastWeek = entry.weekNumber;
      } else if (entry.weekNumber > userStreakCounts[key].lastWeek + 1) {
        userStreakCounts[key].consecutiveWeeks = 1;
        userStreakCounts[key].lastWeek = entry.weekNumber;
      }
    }
  }

  for (const key in userStreakCounts) {
    const record = userStreakCounts[key];
    if (record.consecutiveWeeks >= thresholdWeeks) {
      warnings.push({
        assignedTo: record.assignedTo,
        shiftId: record.shiftId,
        consecutiveWeeks: record.consecutiveWeeks,
        message: `🚨 Burnout Risk: ${record.assignedTo} has covered this shift for ${record.consecutiveWeeks} consecutive weeks.`
      });
    }
  }
  return warnings;
}

export { checkSilentLoad };