import express from 'express';
import cors from 'cors';
import fetch from 'node-fetch';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GOOGLE_SCRIPT_WEBHOOK_URL = process.env.GOOGLE_SCRIPT_WEBHOOK_URL;

app.use(cors());
app.use(express.json({ limit: '10mb' }));

app.get('/', (req, res) => {
  res.send('PuritySales backend is alive 🚀');
});

app.post('/extract-and-assign', async (req, res) => {
  try {
    const { base64pdf, sheetName, overwrite } = req.body;

    if (!base64pdf) {
      return res.status(400).json({ error: 'Missing base64 PDF data.' });
    }

    // ✅ Construct Gemini prompt
    const geminiPayload = {
      contents: [{
        parts: [
          {
            text: `From the PDF below, extract all data under the headers 'Assigned To' and 'IMEI'. 
Return it as an array of objects in this exact JSON format with no explanation or markdown:

[
  { "name": "Narok", "imei": "355234850433208" },
  ...
]`
          },
          {
            inline_data: {
              mime_type: 'application/pdf',
              data: base64pdf
            }
          }
        ]
      }]
    };

    // ✅ Call Gemini
    const geminiResponse = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(geminiPayload)
    });

    const geminiData = await geminiResponse.json();

    const textResponse = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!textResponse) {
      throw new Error('No valid response from Gemini.');
    }

    // ✅ Clean and parse JSON array
    let extractedPairs;
    try {
      const cleanText = textResponse
        .replace(/```json/, '')
        .replace(/```/, '')
        .trim();

      const arrayStart = cleanText.indexOf('[');
      const arrayEnd = cleanText.lastIndexOf(']');

      if (arrayStart === -1 || arrayEnd === -1) {
        throw new Error('No JSON array found in Gemini response.');
      }

      const jsonString = cleanText.substring(arrayStart, arrayEnd + 1);
      console.log("🧼 Cleaned Gemini JSON:", jsonString);

      extractedPairs = JSON.parse(jsonString);
    } catch (jsonError) {
      console.error("❌ JSON parse failed:", textResponse);
      throw new Error("Gemini returned malformed JSON.");
    }

    // ✅ Process sheetNames (can be comma-separated)
    const sheetNames = (sheetName || '').split(',').map(s => s.trim()).filter(Boolean);
    const sheetTargets = sheetNames.length ? sheetNames : [''];

    const results = [];

    for (const item of extractedPairs) {
      const { imei, name } = item;

      for (const sheet of sheetTargets) {
        const bodyData = { imei, name, sheetName: sheet, overwrite };

        console.log(`➡️ Sending IMEI=${imei} to ${sheet || 'Auto'} as ${name}`);

        const assignResponse = await fetch(GOOGLE_SCRIPT_WEBHOOK_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(bodyData)
        });

        const message = await assignResponse.text();
        results.push({ imei, name, sheet, status: message });
      }
    }

    return res.json({ status: 'success', results });

  } catch (err) {
    console.error("❌ Final error:", err.message);
    return res.status(500).json({ status: 'error', message: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`🔥 PuritySales backend running on port ${PORT}`);
});
