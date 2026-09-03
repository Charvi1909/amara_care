import express from 'express';
import cors from 'cors';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';

// Import your AI Engines
import { extractCaregivingTask } from './extractTask.mjs';
import { evaluateCaregiverWorkload } from './workloadManager.mjs';
import { checkScheduleConflicts } from './conflictEngine.mjs';

// Import your teammate's Database Functions
import { getTasks, createTask } from './backend/crud.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());

// Serve the frontend folder so we can view index.html in the browser
app.use(express.static(path.join(__dirname, 'frontend')));

// Configure Multer for image uploads
const upload = multer({ dest: 'uploads/' });

// --- ENDPOINT 1: Get all tasks on page load ---
app.get('/api/tasks', async (req, res) => {
  const { data, error } = await getTasks();
  if (error) return res.status(500).json({ error });
  res.json(data);
});

// --- ENDPOINT 2: The Chaos Engine Pipeline ---
app.post('/api/process-chaos', upload.single('image'), async (req, res) => {
  try {
    const message = req.body.message || "";
    // Note: If you want to process images, you would route req.file to extractFromImage.mjs here
    
    // 1. Run the AI Extraction
    const extractedTask = await extractCaregivingTask(message);
    if (!extractedTask) throw new Error("AI could not extract task.");

    // 2. Fetch current database schedule to check for conflicts/workload
    const { data: currentSchedule } = await getTasks();

    // 3. Run Logic Engines
    const conflicts = checkScheduleConflicts(currentSchedule || [], extractedTask);
    const finalPayload = evaluateCaregiverWorkload(currentSchedule || [], extractedTask);
    
    // Attach conflict warnings if any exist
    if (conflicts.length > 0) {
        finalPayload.warnings.push(...conflicts);
    }

    // 4. Send Review-and-Confirm payload back to the UI
    res.json(finalPayload);

  } catch (error) {
    console.error("Pipeline Error:", error);
    res.status(500).json({ error: 'Failed to process chaos request.' });
  }
});

// --- ENDPOINT 3: Confirm and Save Task ---
app.post('/api/tasks/confirm', async (req, res) => {
  const newTask = req.body;
  const { data, error } = await createTask(newTask);
  if (error) return res.status(500).json({ error });
  res.json({ success: true, data });
});

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`🚀 Amara Server running at http://localhost:${PORT}`);
});