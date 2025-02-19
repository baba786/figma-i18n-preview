const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');
const app = express();

// Read API key from .env file
let CLAUDE_API_KEY;
let PORT = 3000;
try {
  const envPath = path.join(__dirname, '..', '.env');
  const envContent = fs.readFileSync(envPath, 'utf8');
  const apiKeyMatch = envContent.match(/CLAUDE_API_KEY=["']?(.*?)["']?\s*$/m);
  if (apiKeyMatch && apiKeyMatch[1]) {
    CLAUDE_API_KEY = apiKeyMatch[1].trim();
    // Remove any quotes that might have been captured
    CLAUDE_API_KEY = CLAUDE_API_KEY.replace(/^"|\"$|^'|'$/g, '');
    
    if (CLAUDE_API_KEY.startsWith('sk-ant-api')) {
      console.log('API key loaded from .env file with correct prefix');
    } else {
      console.warn('WARNING: API key does not have expected prefix "sk-ant-api"');
    }
  } else {
    console.warn('API key not found in .env file');
    // Try to load from config as fallback
    try {
      const config = require('./config.js');
      CLAUDE_API_KEY = config.CLAUDE_API_KEY;
      PORT = config.PORT || PORT;
    } catch (configErr) {
      console.warn('Could not load config.js, using example config');
      const exampleConfig = require('./config.example.js');
      CLAUDE_API_KEY = exampleConfig.CLAUDE_API_KEY;
      PORT = exampleConfig.PORT || PORT;
    }
  }
} catch (err) {
  console.error('Error reading .env file:', err.message);
  // Fallback to config
  try {
    const config = require('./config.js');
    CLAUDE_API_KEY = config.CLAUDE_API_KEY;
    PORT = config.PORT || PORT;
  } catch (configErr) {
    console.warn('Could not load config.js, using example config');
    const exampleConfig = require('./config.example.js');
    CLAUDE_API_KEY = exampleConfig.CLAUDE_API_KEY;
    PORT = exampleConfig.PORT || PORT;
  }
}

// Enable CORS for all origins during development
app.use(cors({
  origin: '*',
  methods: ['POST', 'GET', 'OPTIONS'],
  allowedHeaders: ['Content-Type']
}));

app.use(express.json());

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok',
    apiKeyConfigured: !!CLAUDE_API_KEY && CLAUDE_API_KEY !== 'YOUR_CLAUDE_API_KEY'
  });
});

app.post('/translate', async (req, res) => {
  try {
    if (!CLAUDE_API_KEY || CLAUDE_API_KEY === 'YOUR_CLAUDE_API_KEY') {
      console.error('API key not configured or invalid');
      return res.status(500).json({ 
        error: 'API key not configured. Please check server setup.',
        details: 'The Claude API key is missing or invalid. Check your .env file.'
      });
    }

    console.log('Translation request body:', req.body);
    const { text, targetLang } = req.body;
    
    // Enhanced validation for empty or UI text
    if (!text || 
        text.trim() === '' || 
        /^[\s\u200B-\u200D\uFEFF\u00A0]*$/.test(text) ||  // Only invisible chars
        /^(search|menu|close|back|\d+:\d+)$/i.test(text)) { // UI elements
      console.log('Skipping UI element or empty text');
      return res.json({ translation: text }); // Return original text
    }

    // Sanitize text
    const sanitizedText = text
      .replace(/[\u0000-\u001F\u007F-\u009F]/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    if (!sanitizedText) {
      return res.json({ translation: text });
    }

    console.log(`Translating text: "${text}" to ${targetLang}`);

    console.log(`Sending translation request to Claude API for: "${sanitizedText}"`);
    // Try updated Claude API format (Claude 3)
    let response;
    
    try {
      response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': CLAUDE_API_KEY,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          model: 'claude-3-opus-20240229',
          max_tokens: 1024,
          messages: [{
            role: 'user',
            content: `Translate the following text to ${targetLang}. Respond with ONLY the translation, no additional context or explanations: "${sanitizedText}"`
          }]
        })
      });
    } catch (fetchError) {
      console.error('Fetch error:', fetchError);
      throw new Error(`Network error: ${fetchError.message}`);
    }

    if (!response.ok) {
      // Add detailed error logging
      const errorBody = await response.text();
      console.error('Claude API error:', errorBody);
      let errorMessage = `Claude API responded with ${response.status}`;
      
      try {
        // Try to parse error details
        const errorJson = JSON.parse(errorBody);
        if (errorJson.error && errorJson.error.message) {
          errorMessage += `: ${errorJson.error.message}`;
        }
      } catch (e) {
        // JSON parsing failed, use text as is
      }
      
      throw new Error(errorMessage);
    }

    const data = await response.json();
    console.log('Response type:', typeof data, 'Contains content:', !!data.content);
    
    // Add additional response validation
    if (!data) {
      throw new Error('Empty response from Claude API');
    }
    // Check if Claude returned expected content format
    if (!data || !data.content || !Array.isArray(data.content) || data.content.length === 0) {
      console.error('Unexpected Claude API response structure:', JSON.stringify(data));
      return res.status(500).json({ 
        error: 'Invalid Claude API response format',
        details: 'The Claude API returned an unexpected response structure.' 
      });
    }
    
    // Check if response has text content
    const content = data.content[0];
    if (!content || !content.text) {
      console.error('Missing text in Claude API response:', JSON.stringify(content));
      return res.status(500).json({ 
        error: 'Missing translation text',
        details: 'The Claude API response did not contain translated text.'
      });
    }
      // Successfully received translation
      const translatedText = content.text.trim();
      console.log(`Translation successful: "${translatedText}"`);
      return res.json({ translation: translatedText });

  } catch (error) {
    console.error('Translation error:', error);
    return res.status(500).json({ 
      error: 'Translation failed',
      message: error.message,
      details: 'Check server logs for more information'
    });
  }
});

// PORT is already defined at the top of the file

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