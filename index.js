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
  res.send('PuritySales backend is alive 🔥');
});

app.post('/extract-and-assign', async (req, res) => {
  try {
    const { base64pdf, sheetName } = req.body;

    if (!base64pdf) {
      return res.status(400).json({ error: 'Missing base64 PDF data.' });
    }

    const geminiPayload = {
      contents: [{
        parts: [
          {
            text: `From the PDF below, extract all data under the headers 'Assigned To' and 'IMEI'. 
Return it as an array of objects in this exact JSON format (NO explanation, no markdown, no bullet points):
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

    const geminiResponse = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(geminiPayload)
    });

    const geminiData = await geminiResponse.json();

    // DEBUG full Gemini response
    console.log("✅ Raw Gemini response:", JSON.stringify(geminiData, null, 2));

    const textResponse = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!textResponse) {
      throw new Error('No valid response from Gemini.');
    }

    // ✅ Clean & extract JSON array from Gemini response
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
      console.log("🧼 Final Cleaned JSON string:\n", jsonString);

      extractedPairs = JSON.parse(jsonString);
    } catch (jsonError) {
      console.error("❌ Failed to parse Gemini JSON:", textResponse);
      throw new Error("Gemini returned invalid JSON.");
    }

    // ✅ Send data to your webhook
    const results = [];

    for (let item of extractedPairs) {
      const { imei, name } = item;

      console.log(`➡️ Assigning IMEI=${imei} to Name=${name} (Sheet=${sheetName})`);

      const assignResponse = await fetch(GOOGLE_SCRIPT_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imei, name, sheetName })
      });

      const message = await assignResponse.text();

      results.push({ imei, name, status: message });
    }

    return res.json({ status: 'success', results });

  } catch (err) {
    console.error("❌ Final Error:", err.message);
    return res.status(500).json({ status: 'error', message: 'Request to backend failed.' });
  }
});

app.listen(PORT, () => {
  console.log(`🔥 PuritySales backend running on port ${PORT}`);
});
