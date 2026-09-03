import { GoogleGenAI } from '@google/genai';

// Uses Node's native environment variable loading
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

function currentDateContext() {
  const now = new Date();
  const iso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const weekday = now.toLocaleDateString('en-US', { weekday: 'long' });
  return { iso, weekday };
}

async function extractCaregivingTask(messyText) {
  const { iso: todayISO, weekday } = currentDateContext();
  const prompt = `
    You are an AI coordinating caregiving tasks.
    The current date is ${todayISO} (${weekday}). Resolve every relative date
    ("today", "tomorrow", "this Friday", "next week") against that date, and
    never invent a year.

    Extract the caregiving task from the following messy text message.

    You MUST output valid JSON only, using this exact structure:
    {
      "id": "abc123",
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
      model: 'gemini-3.6-flash',
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
      }
    });

    const structuredData = JSON.parse(response.text);
    console.log("✅ Successfully extracted task:");
    console.log(structuredData);
    
    return structuredData;

  } catch (error) {
    console.error("❌ Error extracting task:", error);
  }
}

const sampleMessyText = "Hey can someone please grab Mom from dialysis tomorrow at 3pm? I'm stuck at work until 5. - Sarah";
extractCaregivingTask(sampleMessyText);