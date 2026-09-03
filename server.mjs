import express from 'express';
import cors from 'cors';
import multer from 'multer';
import fs from 'node:fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// GEMINI_API_KEY / SUPABASE_* live in backend/.env
dotenv.config({ path: path.join(__dirname, 'backend', '.env') });

// AI engines + DB helpers
import { extractCaregivingTask } from './extractTask.mjs';
import { extractTasks } from './extractFromImage.mjs';
import { evaluateCaregiverWorkload } from './backend/workloadManager.mjs';
import { checkScheduleConflicts } from './backend/conflictEngine.mjs';
import { getTasks, createTask, getFamilyUsers } from './backend/crud.js';
import { supabase } from './backend/supabaseClient.js';
import { handleRecurringTaskAction } from './recurringEngine.mjs';
import { findResources, DEFAULT_LOCATION } from './backend/resourceAssistant.mjs';
import { Resend } from 'resend';
import crypto from 'node:crypto';

// Resend is created lazily so dotenv has definitely run first.
let _resend = null;
const resend = () => {
  if (!_resend && process.env.RESEND_API_KEY) _resend = new Resend(process.env.RESEND_API_KEY);
  return _resend;
};

// Where the emergency e-mail's "I've got this" link points.
const BASE_URL = (process.env.PUBLIC_BASE_URL || 'http://localhost:3000').replace(/\/$/, '');

// Small friendly HTML page for the acknowledge route (clicked from an email).
function ackPage(title, message, tone = 'calm') {
  const accent = tone === 'error' ? '#D90429' : '#8EBD9D';
  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} — Amara</title></head>
<body style="margin:0;font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#EEE5C2;color:#1B475D;">
<div style="max-width:440px;margin:14vh auto;padding:36px;background:#fff;border-radius:20px;box-shadow:0 4px 24px rgba(27,71,93,.15);border-top:6px solid ${accent};text-align:center;">
  <div style="font-family:Georgia,serif;font-size:1.7rem;font-weight:600;margin-bottom:14px;">Amara</div>
  <h1 style="font-size:1.25rem;margin:0 0 10px;">${title}</h1>
  <p style="line-height:1.55;opacity:.85;margin:0;">${message}</p>
</div></body></html>`;
}

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'frontend')));

const UPLOAD_DIR = path.join(__dirname, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
const upload = multer({ dest: UPLOAD_DIR });

// --- Chaos extraction used by the frontend chaos panel ---
// Accepts up to 8 images (field "images") and/or a "message", plus "familyId".
// Returns { tasks: [...] } for the staged-review list. Assignee names are read
// from the conversation and matched against that family's members only.
app.post('/api/extract', upload.array('images', 8), async (req, res) => {
  const files = req.files || [];
  try {
    const body = req.body || {};
    const familyId = body.familyId || null;
    const message = body.message || '';

    if (files.length === 0 && !message.trim()) {
      return res.status(400).json({ error: 'Send a message and/or images.' });
    }

    let familyMembers = [];
    let existingTasks = [];
    if (familyId) {
      const { data: mem } = await getFamilyUsers(familyId);
      familyMembers = mem || [];
      const { data: ts } = await supabase
        .from('tasks').select('id, title, date, time, assigned_to, status')
        .eq('family_id', familyId).neq('status', 'completed');
      const byId = Object.fromEntries(familyMembers.map((m) => [m.id, m.name]));
      existingTasks = (ts || []).map((t) => ({
        title: t.title, date: t.date, time: t.time,
        assignee: t.assigned_to ? (byId[t.assigned_to] || 'Unassigned') : 'Unassigned',
      }));
    }

    const images = files.map((f) => ({
      data: fs.readFileSync(f.path),
      mimeType: f.mimetype || 'image/png',
    }));

    const tasks = await extractTasks({ images, message, familyMembers, existingTasks });
    res.json({ tasks });
  } catch (error) {
    console.error('Extract error:', error);
    res.status(500).json({ error: error.message || 'Extraction failed.' });
  } finally {
    files.forEach((f) => fs.unlink(f.path, () => {}));
  }
});

// --- Resource assistant ("Ask AI" tab) -------------------------------
// A free-text question -> Gemini pulls out keywords + location -> real places
// from OpenStreetMap Nominatim. Up to 5 results. Never throws at the client.
app.post('/api/resource-assistant', async (req, res) => {
  try {
    const message = (req.body && req.body.message ? String(req.body.message) : '').trim();
    if (!message) return res.status(400).json({ error: 'Ask a question first.' });

    const out = await findResources(message, { defaultLocation: DEFAULT_LOCATION });
    res.json(out);
  } catch (error) {
    console.error('resource-assistant error:', error);
    res.status(500).json({ error: "The assistant is unavailable right now. Try again in a moment." });
  }
});

// --- Emergency escalation ---------------------------------------------
// Called by the frontend when a task looks unrecoverable. The server
// re-verifies, stamps tasks.emergency_alerted_at (once), and emails the
// family's emergency contact via Resend. Email failure never blocks the alert.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ESCALATION_WINDOW_MIN = 60;

// Timed task -> deadline within the window (or past).
// Timeless task -> HIGH priority and due today/overdue.
//
// Task times are wall-clock in the USER's timezone. This server can run
// anywhere (localhost in IST, a cloud box in UTC), so when the caller passes
// its clock context — `today` (their local YYYY-MM-DD), `nowMs` (their
// Date.now()), `tzOffsetMin` (their new Date().getTimezoneOffset()) — we use
// it. Falls back to this machine's local time when the context is absent.
function deadlineImminent(dateISO, timeStr, priority, ctx = {}) {
  if (!dateISO) return false;

  const nowMs = Number.isFinite(ctx.nowMs) ? ctx.nowMs : Date.now();
  const tzOffsetMin = Number.isFinite(ctx.tzOffsetMin)
    ? ctx.tzOffsetMin
    : new Date().getTimezoneOffset();
  const today = ctx.today
    || new Date(nowMs - tzOffsetMin * 60000).toISOString().slice(0, 10);

  const m = /^(\d{1,2}):(\d{2})/.exec(String(timeStr || ''));
  if (!m) return priority === 'high' && String(dateISO) <= today;

  const [y, mo, d] = dateISO.split('-').map(Number);
  // Epoch ms of that wall-clock moment in the user's timezone.
  const deadline = Date.UTC(y, mo - 1, d, Number(m[1]), Number(m[2]), 0, 0) + tzOffsetMin * 60000;
  return deadline <= nowMs + ESCALATION_WINDOW_MIN * 60000;
}

app.post('/api/emergency-alert', async (req, res) => {
  try {
    const body = req.body || {};
    const { taskId, familyId } = body;
    if (!taskId || !familyId) return res.status(400).json({ error: 'taskId and familyId required.' });

    const clock = {
      today: typeof body.clientToday === 'string' ? body.clientToday : undefined,
      nowMs: Number(body.clientNowMs),
      tzOffsetMin: Number(body.tzOffsetMin),
    };

    const { data: task } = await supabase
      .from('tasks').select('*').eq('id', taskId).eq('family_id', familyId).maybeSingle();
    if (!task) return res.status(404).json({ error: 'Task not found.' });

    if (task.emergency_alerted_at) {
      return res.json({ alerted: true, alreadyAlerted: true, emailSent: false });
    }
    if (task.status !== 'uncovered_urgent' || task.assigned_to) {
      return res.json({ alerted: false, reason: 'Task is no longer an emergency.' });
    }
    if (!deadlineImminent(task.date, task.time, task.priority, clock)) {
      return res.json({ alerted: false, reason: 'Not at the escalation point yet.' });
    }

    const { data: hos } = await supabase
      .from('handoff_requests').select('status').eq('task_id', taskId);
    if ((hos || []).some((h) => h.status === 'pending' || h.status === 'accepted')) {
      return res.json({ alerted: false, reason: 'A handoff request is still open.' });
    }

    // Claim the alert atomically — only the first request past this wins.
    const ackToken = crypto.randomBytes(18).toString('base64url');
    const { data: stamped } = await supabase
      .from('tasks')
      .update({ emergency_alerted_at: new Date().toISOString(), emergency_ack_token: ackToken })
      .eq('id', taskId)
      .is('emergency_alerted_at', null)
      .select();
    if (!stamped || stamped.length === 0) {
      return res.json({ alerted: true, alreadyAlerted: true, emailSent: false });
    }

    const { data: family } = await supabase
      .from('families').select('name, emergency_contact_name, emergency_contact_info').eq('id', familyId).maybeSingle();
    const contact = {
      name: family?.emergency_contact_name || null,
      info: family?.emergency_contact_info || null,
    };

    let emailSent = false;
    let emailError = null;
    const to = contact.info && EMAIL_RE.test(contact.info) ? contact.info : null;

    if (!to) {
      emailError = contact.info ? 'Emergency contact is not an email address.' : 'No emergency contact set.';
    } else if (!resend()) {
      emailError = 'RESEND_API_KEY not configured.';
    } else {
      try {
        const when = `${task.date}${task.time ? ' at ' + task.time.slice(0, 5) : ''}`;
        const ackUrl = `${BASE_URL}/api/acknowledge/${ackToken}`;
        const result = await resend().emails.send({
          from: 'Amara Care Coordination <onboarding@resend.dev>',
          to,
          subject: `Urgent: no one can cover "${task.title}"`,
          text:
`Hi${contact.name ? ' ' + contact.name : ''},

This is an automated alert from Amara, the care-coordination app used by the ${family?.name || 'family'}.

A care task has gone uncovered and no family member was able to take it on:

  Task:  ${task.title}
  When:  ${when}

The family asked each other to cover it and no one could. You're listed as their emergency contact.

If you can help, click here to let the family know:
  I've got this — ${ackUrl}

— Amara`,
          html:
`<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#1B475D;line-height:1.55;">
  <p>Hi${contact.name ? ' ' + contact.name : ''},</p>
  <p>This is an automated alert from <strong>Amara</strong>, the care-coordination app used by the ${family?.name || 'family'}.</p>
  <p>A care task has gone uncovered and <strong>no family member was able to take it on</strong>:</p>
  <table style="margin:12px 0;"><tr><td style="padding:2px 12px 2px 0;opacity:.7;">Task</td><td><strong>${task.title}</strong></td></tr>
  <tr><td style="padding:2px 12px 2px 0;opacity:.7;">When</td><td>${when}</td></tr></table>
  <p>The family asked each other to cover it and no one could. You're listed as their emergency contact.</p>
  <p style="margin:22px 0;">
    <a href="${ackUrl}" style="background:#1B475D;color:#fff;text-decoration:none;padding:12px 24px;border-radius:10px;font-weight:700;display:inline-block;">I've got this</a>
  </p>
  <p style="font-size:.85rem;opacity:.6;">Clicking that lets the family know help is on the way.</p>
  <p>— Amara</p>
</div>`,
        });
        if (result.error) { emailError = result.error.message || String(result.error); }
        else { emailSent = true; }
      } catch (err) {
        emailError = err.message || String(err);
      }
    }

    if (emailError) console.warn('Emergency contact email not sent:', emailError);

    // Also notify every logged-in family member by email (best effort).
    let membersNotified = 0;
    try {
      if (resend()) {
        const { data: members } = await supabase
          .from('users').select('name, email').eq('family_id', familyId).not('auth_id', 'is', null);
        const when2 = `${task.date}${task.time ? ' at ' + task.time.slice(0, 5) : ''}`;
        const recips = (members || []).filter((m) => m.email && EMAIL_RE.test(m.email));
        await Promise.all(recips.map(async (m) => {
          try {
            const r = await resend().emails.send({
              from: 'Amara Care Coordination <onboarding@resend.dev>',
              to: m.email,
              subject: `Emergency contact notified: "${task.title}"`,
              text:
`Hi ${m.name || ''},

No one in the family was able to cover this task, so Amara has notified your emergency contact${contact.name ? ` (${contact.name})` : ''}:

  Task:  ${task.title}
  When:  ${when2}

If you can now cover it after all, open Amara and claim it.

— Amara`,
            });
            if (!r.error) membersNotified += 1;
          } catch (e) {
            console.warn('Member notify failed for', m.email, '-', e.message || e);
          }
        }));
      }
    } catch (e) {
      console.warn('Member notification step failed:', e.message || e);
    }

    res.json({ alerted: true, emailSent, emailError, contact, membersNotified });
  } catch (error) {
    console.error('Emergency alert error:', error);
    res.status(500).json({ error: error.message || 'Emergency alert failed.' });
  }
});

// The "I've got this" link in the emergency e-mail lands here.
app.get('/api/acknowledge/:token', async (req, res) => {
  res.set('Content-Type', 'text/html; charset=utf-8');
  try {
    const token = req.params.token || '';
    const { data: task } = await supabase
      .from('tasks')
      .select('id, title, emergency_acked_at')
      .eq('emergency_ack_token', token)
      .maybeSingle();

    if (!task) {
      return res.status(404).send(ackPage(
        'Link not recognised',
        "This acknowledgment link isn't valid. It may have been mistyped — no action was taken.",
        'error'
      ));
    }

    if (task.emergency_acked_at) {
      const when = new Date(task.emergency_acked_at).toLocaleString();
      return res.send(ackPage(
        'Already acknowledged',
        `Thanks — this alert was already acknowledged on ${when}. The family knows help is on the way.`
      ));
    }

    await supabase
      .from('tasks')
      .update({ emergency_acked_at: new Date().toISOString() })
      .eq('id', task.id)
      .is('emergency_acked_at', null);

    res.send(ackPage(
      'Thank you',
      `The family has been told that help is on the way for "<strong>${task.title}</strong>". They'll see it update in the app right away.`
    ));
  } catch (error) {
    console.error('Acknowledge error:', error);
    res.status(500).send(ackPage('Something went wrong', 'Please try the link again in a moment.', 'error'));
  }
});

// --- Existing endpoints (main branch) ---------------------------------

app.get('/api/tasks', async (req, res) => {
  const { data, error } = await getTasks();
  if (error) return res.status(500).json({ error });
  res.json(data);
});

app.post('/api/process-chaos', upload.single('image'), async (req, res) => {
  try {
    const message = req.body.message || '';
    const { data: currentSchedule } = await getTasks();
    const extractedTask = await extractCaregivingTask(message, { existingTasks: currentSchedule || [] });
    if (!extractedTask) throw new Error('AI could not extract task.');

    const conflicts = checkScheduleConflicts(currentSchedule || [], extractedTask);
    const finalPayload = evaluateCaregiverWorkload(currentSchedule || [], extractedTask);
    if (conflicts.length > 0) finalPayload.warnings.push(...conflicts);
    if (extractedTask.skipped) {
      finalPayload.warnings.push(
        `Possible duplicate of "${extractedTask.duplicateOf.title}" already on the calendar — not added automatically.`
      );
    }
    finalPayload.task = extractedTask;

    res.json(finalPayload);
  } catch (error) {
    console.error('Pipeline Error:', error);
    res.status(500).json({ error: 'Failed to process chaos request.' });
  }
});

app.post('/api/tasks/confirm', async (req, res) => {
  const { data, error } = await createTask(req.body);
  if (error) return res.status(500).json({ error });
  res.json({ success: true, data });
});

app.post('/api/tasks/recurring-action', async (req, res) => {
  try {
    const { taskId, actionType, targetDate, newAssignee } = req.body;
    const result = await handleRecurringTaskAction(taskId, actionType, targetDate, newAssignee);
    res.json({ success: true, result });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`🚀 Amara server on http://localhost:${PORT}`);
  if (!process.env.GEMINI_API_KEY) {
    console.warn('⚠  GEMINI_API_KEY not set in backend/.env — /api/extract will fail.');
  }
});
