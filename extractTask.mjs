import { GoogleGenAI } from '@google/genai';
import { createTask, findUserByName } from './backend/crud.js';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

async function extractCaregivingTask(messyText) {
  const prompt = `
    You are an AI coordinating caregiving tasks. 
    Extract the caregiving task from the following messy text message. 

    For "assignedTo", use the actual first name of the person responsible, 
    if mentioned in the text. Only use "unassigned" if genuinely unclear.

    You MUST output valid JSON only, using this exact structure:
    {
      "title": "Short title",
      "originalText": "${messyText}",
      "assignedTo": "unassigned",
      "date": "2026-06-06",
      "time": "15:00",
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

    await createTask({
      ...rest,
      assigned_to: matchedUserId,
      original_text: originalText
    });

    console.log("Saved to Supabase:", { ...rest, assigned_to: matchedUserId });

    return structuredData;

  } catch (error) {
    console.error("❌ Error extracting task:", error);
  }
}

const sampleMessyText = "Hey can someone please grab Mom from dialysis tomorrow at 3pm? I'm stuck at work until 5. - Sarah";
extractCaregivingTask(sampleMessyText);