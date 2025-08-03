// index.js

import express from 'express';
import fetch from 'node-fetch';
import dotenv from 'dotenv';

dotenv.config();
const app = express();
const PORT = process.env.PORT || 3000;

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GOOGLE_SCRIPT_WEBHOOK_URL = process.env.GOOGLE_SCRIPT_WEBHOOK_URL;

app.use(express.json({ limit: '10mb' }));

// Health check
app.get('/', (req, res) => {
  res.send('PuritySales backend is live!');
});

// Gemini + Assign IMEI route
app.post('/extract-and-assign', async (req, res) => {
  try {
    const { base64pdf, sheetName } = req.body;

    if (!base64pdf) {
      return res.status(400).json({ error: 'Missing base64 PDF data.' });
    }

    // 1. Call Gemini API to extract IMEI–Name pairs
    const geminiPayload = {
      contents: [{
        parts: [
          {
            text: `From the PDF below, extract all data under the headers 'Assigned To' and 'IMEI'. 
Format the result like:
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

    const pairs = JSON.parse(textResponse); // array of { imei, name }

    const resultSummary = [];

    // 2. For each pair, send to Google Script webhook
    for (let item of pairs) {
      const { imei, name } = item;
      const assignResponse = await fetch(GOOGLE_SCRIPT_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imei, name, sheetName })
      });

      const message = await assignResponse.text();

      resultSummary.push({
        imei,
        name,
        status: message
      });
    }

    res.json({ status: 'done', results: resultSummary });

  } catch (err) {
    console.error('Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`🔥 PuritySales backend running on port ${PORT}`);
});
