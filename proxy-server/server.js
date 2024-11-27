const express = require('express');
const cors = require('cors');
const app = express();

// Your Claude API key
const CLAUDE_API_KEY = 'YOUR_CLAUDE_API_KEY';

// Enable CORS for Figma plugin
app.use(cors());
app.use(express.json());

app.post('/translate', async (req, res) => {
  try {
    const { text, targetLang } = req.body;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': CLAUDE_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-3-opus-20240229',
        max_tokens: 1024,
        messages: [{
          role: 'user',
          content: `Translate the following text to ${targetLang}. Respond with ONLY the translation, no additional context or explanations: "${text}"`
        }]
      })
    });

    if (!response.ok) {
      throw new Error(`Claude API responded with ${response.status}`);
    }

    const data = await response.json();
    res.json({ translation: data.content[0].text });

  } catch (error) {
    console.error('Translation error:', error);
    res.status(500).json({ error: error.message });
  }
});

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Proxy server running on http://localhost:${PORT}`);
});