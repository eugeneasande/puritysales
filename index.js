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

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Health check
app.get('/', (req, res) => {
  res.send('PuritySales backend is alive 🔥');
});

// Main endpoint
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

    const geminiResponse = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`, {

      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(geminiPayload)
    });

    const geminiData = await geminiResponse.json();

    // DEBUG: Log full Gemini response
    console.log("✅ Raw Gemini response:", JSON.stringify(geminiData, null, 2));

    const textResponse = geminiData.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!textResponse) {
      console.error("❌ Gemini returned no usable content.");
      throw new Error('No valid response from Gemini.');
    }

    let extractedPairs;
    try {
      extractedPairs = JSON.parse(textResponse); // Expecting array of { name, imei }
    } catch (jsonError) {
      console.error("❌ Failed to parse Gemini response as JSON:", textResponse);
      throw new Error("Gemini returned malformed JSON.");
    }

    const results = [];

    // 2️⃣ Send each extracted pair to Google Script webhook
    for (let item of extractedPairs) {
      const { imei, name } = item;

      // DEBUG: Log every assign attempt
      console.log(`➡️ Assigning: IMEI=${imei}, Name=${name}, Sheet=${sheetName || 'auto'}`);

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
    console.error('❌ Final Error:', err.message);
    res.status(500).json({ status: 'error', message: 'Request to backend failed.' });
  }
});

app.listen(PORT, () => {
  console.log(`🔥 PuritySales backend running on port ${PORT}`);
});
