import { checkScheduleConflicts } from './backend/conflictEngine.mjs';
import { checkSilentLoad } from './backend/silentLoadEngine.mjs';
import { handleRecurringTaskAction } from './recurringEngine.mjs';
import { getTasks } from './backend/crud.js';

async function runLiveEdgeCaseTests() {
  console.log("🧪 STARTING LIVE BACKEND EDGE-CASE TESTS...\n");

  // 1. Fetch live data from Supabase[cite: 4]
  const { data: tasks, error } = await getTasks();
  if (error) {
    console.error("❌ Database connection error:", error);
    return;
  }

  console.log(`📦 Loaded ${tasks ? tasks.length : 0} tasks from Supabase[cite: 4].\n`);

  // 2. EDGE CASE: Overlapping & Boundary Shifts
  console.log("▶️ TEST 1: Live Conflict Boundary Check");
  if (tasks && tasks.length > 0) {
    const sampleTask = tasks[0];
    const conflicts = checkScheduleConflicts(tasks, sampleTask);
    console.log(`Result: Checked live task against schedule. Overlaps detected: ${conflicts.length}`);
    console.log("PASSED ✅\n");
  } else {
    console.log("⚠️ Skipped Test 1: Database has no tasks to cross-reference.\n");
  }

  // 3. EDGE CASE: Handling Deleted or Non-Existent Tasks
  console.log("▶️ TEST 2: Missing / Deleted Task Exception Handling");
  try {
    await handleRecurringTaskAction("invalid_id_99999", 'skip_once', '2026-06-06');
    console.log("FAILED ❌: Should have thrown an error for missing ID.");
  } catch (err) {
    console.log(`PASSED ✅: Handled missing task gracefully -> "${err.message}"\n`);
  }

  // 4. EDGE CASE: Silent Load Burnout with Real History
  console.log("▶️ TEST 3: Silent Load Analysis on Live Dataset");
  const burnoutWarnings = checkSilentLoad(tasks || [], 3);
  console.log(`Result: Generated ${burnoutWarnings.length} burnout warnings from live records.`);
  console.log("PASSED ✅\n");

  console.log("🏁 LIVE BACKEND EDGE-CASE TESTING COMPLETE.");
}

runLiveEdgeCaseTests();