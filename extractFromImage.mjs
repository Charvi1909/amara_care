import { GoogleGenAI } from '@google/genai';
import fs from 'node:fs';
import { createTask, findUserByName } from './backend/crud.js';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

function fileToGenerativePart(filePath, mimeType) {
  return {
    inlineData: {
      data: Buffer.from(fs.readFileSync(filePath)).toString("base64"),
      mimeType
    },
  };
}

async function extractTaskFromMultipleScreenshots(imagePaths) {
  const imageParts = imagePaths.map(path => fileToGenerativePart(path, "image/png"));

  const prompt = `
    Analyze these WhatsApp chat screenshots in chronological order. This may be a 
    one-on-one chat or a group chat.

    In WhatsApp: right-aligned green messages are always sent by the phone's owner. 
    Left-aligned grey messages are from other people. In a GROUP chat, each other 
    sender's name is printed directly above their message bubble. In a one-on-one 
    chat, the other person's name appears at the top of the screen instead, and 
    all grey messages are from them.

    Identify who committed to or was asked to do each caregiving task based on the 
    conversation and who is actually speaking. For example, if someone says "okayy" 
    right after being asked to do something, that confirms they are taking on that 
    task.

    Synthesize the conversation to find EVERY distinct caregiving task, schedule, 
    or request mentioned across the images.

    IMPORTANT: Treat each separate action as its own task. Do not combine multiple 
    actions into one task.

    For "assignedTo", use the actual first name of the person who committed to or 
    was assigned the task. Only use "unassigned" if genuinely unclear.

    You MUST output valid JSON only, as an ARRAY of task objects, using this exact structure:
    [
      {
        "title": "<short title of a single task>",
        "originalText": "<the relevant text from the screenshots>",
        "assignedTo": "<the actual first name of the responsible person, or 'unassigned'>",
        "date": "<YYYY-MM-DD>",
        "time": "<HH:MM>",
        "recurring": false,
        "status": "pending_confirmation",
        "source": "ai_extracted"
      }
    ]
  `;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3.1-flash-lite',
      contents: [prompt, ...imageParts],
      config: { responseMimeType: 'application/json' }
    });

    const structuredDataArray = JSON.parse(response.text);

    for (const task of structuredDataArray) {
      const { id, originalText, assignedTo, ...rest } = task;
      const matchedUserId = await findUserByName(assignedTo);

      await createTask({
        ...rest,
        assigned_to: matchedUserId,
        original_text: originalText
      });
    }

    console.log(`Saved ${structuredDataArray.length} tasks to Supabase from screenshots`);

    return structuredDataArray;

  } catch (error) {
    console.error("❌ Error parsing screenshots:", error);
  }
}

extractTaskFromMultipleScreenshots(["chat_screenshot_1.png", "chat_screenshot_2.png"]);