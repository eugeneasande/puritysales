// index.js

import express from 'express';
import cors from 'cors';
import fetch from 'node-fetch';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GOOGLE_SCRIPT_WEBHOOK_URL = process.env.GOOGLE_SCRIPT_WEBHOOK_URL;

// ✅ Enable CORS (this is the fix)
app.use(cors());

// ✅ Parse JSON and handle big uploads (PDFs)
app.use(express.json({ limit: '10mb' }));

// Health check
app.get('/', (req, res) => {
  res.send('PuritySales backend is alive 🔥');
});

// ✅ POST endpoint for extraction + assignment
app.post('/extract-and-assign', async (req, res) => {
  try {
    const { base64pdf, sheetName } = req.body;

    if (!base64pdf) {
      return res.status(400).json({ error: 'Missing base64 PDF data.' });
    }

    // 1️⃣ Prepare Gemini request
    const geminiPayload = {
      contents: [{
        parts: [
          {
            text: `From the PDF below, extract all data under the headers 'Assigned To' and 'IMEI'. 
Return it in this exact JSON format (no explanation):
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

    const geminiResponse = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:generateContent?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(geminiPayload)
    });

    const geminiData = await geminiResponse.json();
    const textResponse = geminiData.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!textResponse) {
      throw new Error('No valid response from Gemini.');
    }

    const extractedPairs = JSON.parse(textResponse); // Expecting array of { name, imei }

    const results = [];

    // 2️⃣ Send each extracted pair to Google Script webhook
    for (let item of extractedPairs) {
      const { imei, name } = item;

      const assignResponse = await fetch(GOOGLE_SCRIPT_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imei, name, sheetName })
      });

      const message = await assignResponse.text();

      results.push({
        imei,
        name,
        status: message
      });
    }

    res.json({ status: 'success', results });

  } catch (err) {
    console.error('❌ Error:', err.message);
    res.status(500).json({ status: 'error', message: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`🔥 PuritySales backend running on port ${PORT}`);
});
