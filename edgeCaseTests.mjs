import { checkScheduleConflicts } from './conflictEngine.mjs';
import { checkSilentLoad } from './silentLoadEngine.mjs';
import { evaluateCaregiverWorkload } from './workloadManager.mjs';

console.log("🧪 STARTING EDGE CASE TESTS...\n");

// --- 1. CONFLICT ENGINE: The Boundary Test ---
console.log("▶️ TEST 1: The Boundary Overlap");
const existingSchedule = [{
  id: "t1", title: "Morning Shift", assignedTo: "Sarah", date: "2026-06-06", time: "10:00", endTime: "11:00"
}];
const boundaryTask = {
  id: "t2", title: "Midday Shift", assignedTo: "Sarah", date: "2026-06-06", time: "11:00", endTime: "12:00"
};
const conflictResult = checkScheduleConflicts(existingSchedule, boundaryTask);
console.log(`Expected: 0 conflicts. Actual: ${conflictResult.length}`);
if (conflictResult.length > 0) console.log("FAILED ❌:", conflictResult);
else console.log("PASSED ✅\n");


// --- 2. SILENT LOAD: The Broken Streak ---
console.log("▶️ TEST 2: The Broken Streak (Gap Week)");
const interruptedHistory = [
  { assignedTo: "David", shiftId: "weekend_nights", date: "2026-05-01", weekNumber: 1 },
  { assignedTo: "David", shiftId: "weekend_nights", date: "2026-05-08", weekNumber: 2 },
  // Week 3 skipped!
  { assignedTo: "David", shiftId: "weekend_nights", date: "2026-05-22", weekNumber: 4 },
  { assignedTo: "David", shiftId: "weekend_nights", date: "2026-05-29", weekNumber: 5 }
];
// Threshold is 4 weeks. David worked 4 weeks total, but not consecutively.
const streakResult = checkSilentLoad(interruptedHistory, 4);
console.log(`Expected: 0 warnings. Actual: ${streakResult.length}`);
if (streakResult.length > 0) console.log("FAILED ❌:", streakResult);
else console.log("PASSED ✅\n");


// --- 3. WORKLOAD MANAGER: Multi-User Mix-Up ---
console.log("▶️ TEST 3: Multi-User Shift Counting");
const mixedSchedule = [
  { id: "s1", title: "Morning Meds", assignedTo: "Sarah", date: "2026-06-06", time: "08:00" },
  { id: "s2", title: "Afternoon Physio", assignedTo: "David", date: "2026-06-06", time: "14:00" }
];
const newShiftForSarah = {
  id: "s3", title: "Evening Run", assignedTo: "Sarah", date: "2026-06-07", time: "10:00"
};
// There are 3 total shifts in the 48h window, but Sarah only has 2 of them.
const workloadResult = evaluateCaregiverWorkload(mixedSchedule, newShiftForSarah);
console.log(`Expected needsRest: false. Actual: ${workloadResult.metadata.needsRest}`);
if (workloadResult.metadata.needsRest) console.log("FAILED ❌:", workloadResult.warnings);
else console.log("PASSED ✅\n");

console.log("🏁 EDGE CASE TESTS COMPLETE.");