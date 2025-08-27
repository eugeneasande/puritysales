import express from 'express';
import cors from 'cors';
import fetch from 'node-fetch';
import dotenv from 'dotenv';
import { jsonrepair } from 'jsonrepair';

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
    const { base64pdf, imeis, sheetName, overwrite } = req.body;

    // 🚨 Validate input
    if (!base64pdf && (!imeis || !Array.isArray(imeis) || imeis.length === 0)) {
      return res.status(400).json({ error: 'Either base64pdf or imeis[] is required.' });
    }

    let extractedPairs = [];

    if (base64pdf) {
      // ✅ Prompt Gemini with PDF
      const geminiPayload = {
        contents: [{
          parts: [
            {
              text: `From the PDF below, extract all data under the headers 'Assigned To' and 'IMEI'. 
Return it strictly as an array of objects in this exact JSON format with no extra text:

[
  { "name": "Narok", "imei": "355234850433208" }
]`
            },
            {
              inline_data: {
                mime_type: 'application/pdf',
                data: base64pdf
              }
            }
          ]
        }],
        generationConfig: {
          responseMimeType: "application/json"
        }
      };

      const geminiResponse = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(geminiPayload)
        }
      );

      const geminiData = await geminiResponse.json();
      const textResponse = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text;

      if (!textResponse) throw new Error('No valid response from Gemini.');

      try {
        extractedPairs = JSON.parse(textResponse);
      } catch (err) {
        console.warn("⚠️ JSON parse failed, attempting repair...");
        extractedPairs = JSON.parse(jsonrepair(textResponse));
      }

    } else {
      // ✅ Manual IMEI entry — require name + imei
      extractedPairs = imeis.map(item => {
        if (typeof item === 'string') {
          throw new Error('Manual entries must include both IMEI and Name as an object.');
        }

        const { imei, name } = item;
        if (!imei || !name) {
          throw new Error('Each manual IMEI must include both imei and name.');
        }

        return {
          imei: imei.trim(),
          name: name.trim()
        };
      });
    }

    // ✅ Sheet name logic
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
