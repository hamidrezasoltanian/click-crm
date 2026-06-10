'use strict';

const express = require('express');
const https = require('https');
const { requireAuth } = require('../auth');

const { query: dbQuery } = require('../db');

const router = express.Router();

// All AI routes require auth
router.use(requireAuth);

async function getApiKey() {
  // 1. environment variable takes priority
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY;
  // 2. fallback: DB.settings.anthropicKey
  try {
    const r = await dbQuery("SELECT value FROM app_data WHERE key='main'");
    if (r.rows.length) {
      const key = r.rows[0].value?.settings?.anthropicKey;
      if (key) return key;
    }
  } catch (_) {}
  return null;
}

async function callAnthropic(apiKey, payload, betaHeader) {
  const bodyStr = JSON.stringify(payload);
  return new Promise((resolve, reject) => {
    const headers = {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Length': Buffer.byteLength(bodyStr),
    };
    if (betaHeader) headers['anthropic-beta'] = betaHeader;
    const options = {
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers,
    };
    const reqHttp = https.request(options, (httpRes) => {
      let data = '';
      httpRes.on('data', (chunk) => { data += chunk; });
      httpRes.on('end', () => {
        try { resolve({ status: httpRes.statusCode, body: JSON.parse(data) }); }
        catch (e) { resolve({ status: httpRes.statusCode, body: { error: data } }); }
      });
    });
    reqHttp.on('error', reject);
    reqHttp.write(bodyStr);
    reqHttp.end();
  });
}

// POST /api/ai/analyze — proxy to Anthropic API
router.post('/analyze', async (req, res) => {
  const apiKey = await getApiKey();
  if (!apiKey) {
    return res.status(503).json({ error: 'سرویس هوش مصنوعی در دسترس نیست. کلید API را در ⚙ تنظیمات وارد کنید.' });
  }

  const { messages, system, max_tokens, model } = req.body || {};
  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'پارامتر messages الزامی است' });
  }

  const payload = {
    model: model || 'claude-sonnet-4-20250514',
    max_tokens: max_tokens || 4096,
    messages,
  };
  if (system) payload.system = system;

  try {
    const result = await callAnthropic(apiKey, payload);
    return res.status(result.status).json(result.body);
  } catch (e) {
    console.error('[ai/analyze]', e.message);
    return res.status(500).json({ error: 'خطا در اتصال به سرویس هوش مصنوعی' });
  }
});

module.exports = router;
