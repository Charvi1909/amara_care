import { GoogleGenAI } from '@google/genai';
import { createTask, findUserByName } from './backend/crud.js';
import { findDuplicateTask } from './backend/taskMatch.mjs';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

function currentDateContext() {
  const now = new Date();
  const iso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const weekday = now.toLocaleDateString('en-US', { weekday: 'long' });
  return { iso, weekday };
}

async function extractCaregivingTask(messyText, { existingTasks = [] } = {}) {
  const { iso: todayISO, weekday } = currentDateContext();
  const prompt = `
    You are an AI coordinating caregiving tasks.
    The current date is ${todayISO} (${weekday}). Resolve every relative date
    ("today", "tomorrow", "this Friday", "next week") against that date, and
    never invent a year.

    Extract the caregiving task from the following messy text message.

    For "assignedTo", use the actual first name of the person responsible,
    if mentioned in the text. Only use "unassigned" if genuinely unclear.

    You MUST output valid JSON only, using this exact structure:
    {
      "title": "Short title",
      "originalText": "${messyText}",
      "assignedTo": "unassigned",
      "date": "<YYYY-MM-DD>",
      "time": "<HH:MM 24-hour>",
      "recurring": false,
      "status": "pending_confirmation",
      "source": "ai_extracted"
    }

    Messy text message: "${messyText}"
  `;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3.1-flash-lite',
      contents: prompt,
      config: { responseMimeType: 'application/json' }
    });

    const structuredData = JSON.parse(response.text);
    const { id, originalText, assignedTo, ...rest } = structuredData;
    const matchedUserId = await findUserByName(assignedTo);

    // Duplicate guard: don't silently create a second copy of a task that's
    // already on the calendar. Flag it for review instead.
    const dup = findDuplicateTask(rest, existingTasks);
    if (dup) {
      console.log('Skipped likely-duplicate task:', rest.title, '≈', dup.title);
      return {
        ...structuredData,
        duplicateOf: { title: dup.title, date: dup.date, time: dup.time, assignee: dup.assignee },
        skipped: true,
      };
    }

    await createTask({
      ...rest,
      assigned_to: matchedUserId,
      original_text: originalText
    });

    console.log("Saved to Supabase:", { ...rest, assigned_to: matchedUserId });

    return { ...structuredData, duplicateOf: null, skipped: false };

  } catch (error) {
    console.error("❌ Error extracting task:", error);
  }
}

const sampleMessyText = "Hey can someone please grab Mom from dialysis tomorrow at 3pm? I'm stuck at work until 5. - Sarah";
export { extractCaregivingTask };