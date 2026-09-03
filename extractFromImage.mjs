import { GoogleGenAI } from '@google/genai';
import { findDuplicateTask } from './backend/taskMatch.mjs';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// image: { data: Buffer|Uint8Array, mimeType: string }
function bufferToGenerativePart(image) {
  return {
    inlineData: {
      data: Buffer.from(image.data).toString('base64'),
      mimeType: image.mimeType || 'image/png',
    },
  };
}

// Match a name the model read out of the chat to a family member.
// Nothing is hardcoded: the name comes from the conversation, and we only
// accept it if it resolves to exactly one member of THIS family.
function resolveMember(rawName, familyMembers) {
  const name = String(rawName || '').trim().toLowerCase();
  if (!name || name === 'unassigned' || name === 'unknown') return null;
  const first = name.split(/\s+/)[0];
  const hits = familyMembers.filter((m) => {
    const mn = m.name.trim().toLowerCase();
    return mn === name || mn.split(/\s+/)[0] === first;
  });
  return hits.length === 1 ? hits[0] : null; // 0 = not in family, >1 = ambiguous
}

/**
 * Extract caregiving tasks from chat screenshots and/or a typed message.
 * Nothing about the family is baked in — assignee names are read from the
 * conversation, then matched against `familyMembers`; anything that doesn't
 * match (or is ambiguous / unclaimed) comes back as "Unassigned".
 *
 * @param {{ images?: {data:Buffer,mimeType:string}[], message?: string,
 *           familyMembers?: {id:string,name:string}[] }} input
 * @returns {Promise<Array<{title,date,time,assignee,assigned_to,category,originalText,recurring}>>}
 */
export async function extractTasks({ images = [], message = '', familyMembers = [], existingTasks = [] } = {}) {
  const hasImages = images.length > 0;
  const hasMessage = message && message.trim().length > 0;
  if (!hasImages && !hasMessage) return [];

  const now = new Date();
  const todayISO = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const weekday = now.toLocaleDateString('en-US', { weekday: 'long' });

  const prompt = `
    You are extracting caregiving tasks from a family conversation.
    ${hasImages
      ? `The images are WhatsApp chat screenshots. Read them in chronological order.
         In WhatsApp: right-aligned green bubbles are the phone owner's messages;
         left-aligned grey bubbles are other people. In a GROUP chat each other
         person's name is printed above their bubble; in a 1-on-1 chat the other
         person's name is at the top of the screen.`
      : ''}
    ${hasMessage
      ? `${hasImages ? 'The user also typed this — treat it as part of the same conversation and extract tasks from it too:' : 'Message:'}
         """${message.trim()}"""`
      : ''}

    Today is ${todayISO} (${weekday}). Resolve relative dates ("today", "tomorrow",
    "this Friday", "next week") against today. Never invent a year.

    Find EVERY distinct caregiving task, errand, appointment or reminder. Treat each
    separate action as its own task — do not merge.

    For "assignedTo": read the ACTUAL name from the conversation of whoever clearly
    took the task on (e.g. they replied "okay" / "sure" / "I'll do it" / "on it" to
    a request, or were explicitly assigned). Use the name exactly as written in the
    chat. If the task is a general request with no clear owner, if it's ambiguous,
    or if nobody committed, set "assignedTo" to "unassigned". Do not guess.

    Output valid JSON ONLY — an ARRAY of objects with this exact shape:
    [
      {
        "title": "<short task title>",
        "originalText": "<the line(s) this came from>",
        "assignedTo": "<name from the chat, or 'unassigned'>",
        "date": "<YYYY-MM-DD>",
        "time": "<HH:MM 24-hour, or ''>",
        "category": "<medication|appointment|grocery|general>",
        "recurring": false
      }
    ]
  `;

  const parts = [prompt, ...images.map(bufferToGenerativePart)];

  let response;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      response = await ai.models.generateContent({
        model: 'gemini-3.1-flash-lite',
        contents: parts,
        config: { responseMimeType: 'application/json' },
      });
      break;
    } catch (err) {
      if (attempt === 3 || !/50[23]|429|overloaded|UNAVAILABLE/i.test(String(err))) throw err;
      await new Promise((r) => setTimeout(r, attempt * 1500));
    }
  }

  let parsed = JSON.parse(response.text);
  if (!Array.isArray(parsed)) parsed = parsed ? [parsed] : [];

  return parsed.map((t) => {
    const member = resolveMember(t.assignedTo, familyMembers);
    let time = String(t.time || '').slice(0, 5);
    if (!/^\d{1,2}:\d{2}$/.test(time) || time === '00:00') time = ''; // no time stated
    const out = {
      title: t.title || 'Untitled task',
      date: t.date || todayISO,
      time, // '' when the conversation gave no time — UI shows "Any time"
      category: ['medication', 'appointment', 'grocery', 'general'].includes(t.category) ? t.category : 'general',
      assignee: member ? member.name : 'Unassigned',
      assigned_to: member ? member.id : null,
      originalText: t.originalText || '',
      recurring: !!t.recurring,
    };
    const dup = findDuplicateTask(out, existingTasks);
    out.duplicateOf = dup ? { title: dup.title, date: dup.date, time: dup.time, assignee: dup.assignee } : null;
    return out;
  });
}

// Back-compat alias
export const extractTasksFromImages = (images, opts = {}) =>
  extractTasks({ images, message: opts.extraText || '', familyMembers: opts.familyMembers || [] });
