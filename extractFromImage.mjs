import { GoogleGenAI } from '@google/genai';
import fs from 'node:fs';

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
  // Map all image paths to generative parts
  const imageParts = imagePaths.map(path => fileToGenerativePart(path, "image/png"));

  const now = new Date();
  const todayISO = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const weekday = now.toLocaleDateString('en-US', { weekday: 'long' });

  const prompt = `
    Analyze these chat screenshots in chronological order. Synthesize the conversation
    to find any caregiving tasks, schedules, or requests mentioned across the images.

    The current date is ${todayISO} (${weekday}). Resolve every relative date
    ("today", "tomorrow", "this Friday", "next week") against that date, and
    never invent a year.

    You MUST output valid JSON only, using this exact team structure:
    {
      "id": "abc123",
      "title": "<short title of task>",
      "originalText": "<transcribe the relevant text from the screenshots>",
      "assignedTo": "<name or 'unassigned'>",
      "date": "<YYYY-MM-DD>",
      "time": "<HH:MM>",
      "recurring": false,
      "status": "pending_confirmation",
      "source": "ai_extracted"
    }
  `;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3.6-flash',
      // Pass the prompt followed by all image parts in the contents array
      contents: [prompt, ...imageParts],
      config: {
        responseMimeType: 'application/json',
      }
    });

    const structuredData = JSON.parse(response.text);
    console.log("📸 Successfully extracted task from multiple screenshots:");
    console.log(structuredData);
    
    return structuredData;

  } catch (error) {
    console.error("❌ Error parsing screenshots:", error);
  }
}

// Pass an array of multiple files
extractTaskFromMultipleScreenshots(["chat_screenshot_1.png", "chat_screenshot_2.png"]);