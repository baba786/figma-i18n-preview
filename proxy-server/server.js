const express = require('express');
const cors = require('cors');
const app = express();

// Your Claude API key
const CLAUDE_API_KEY = 'YOUR_CLAUDE_API_KEY';

// Enable CORS for all origins during development
app.use(cors({
  origin: '*',
  methods: ['POST', 'GET', 'OPTIONS'],
  allowedHeaders: ['Content-Type']
}));

app.use(express.json());

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.post('/translate', async (req, res) => {
  try {
    const { text, targetLang } = req.body;
    
    if (!text || !targetLang) {
      return res.status(400).json({ 
        error: 'Missing required fields: text and targetLang' 
      });
    }

    console.log(`Translating text: "${text}" to ${targetLang}`);

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
    console.log(`Translation successful: "${data.content[0].text}"`);
    
    res.json({ translation: data.content[0].text.trim() });

  } catch (error) {
    console.error('Translation error:', error);
    res.status(500).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 3000;

// Try multiple ports if the default is in use
function startServer(port) {
  app.listen(port)
    .on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        console.log(`Port ${port} is busy, trying ${port + 1}...`);
        startServer(port + 1);
      } else {
        console.error('Server error:', err);
      }
    })
    .on('listening', () => {
      console.log(`Proxy server running on http://localhost:${port}`);
      console.log('Ready to handle translation requests');
    });
}

startServer(PORT);