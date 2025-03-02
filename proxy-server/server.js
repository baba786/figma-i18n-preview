const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');
const app = express();

// Simple in-memory cache for translations
// Structure: { [targetLang]: { [sourceText]: translatedText } }
const translationCache = {};

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

// Enable CORS for all origins during development with more permissive settings
app.use(cors({
  origin: '*',
  methods: ['POST', 'GET', 'OPTIONS', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  credentials: false,
  maxAge: 86400 // Cache preflight request for 24 hours
}));

// Add error handling middleware
app.use((err, req, res, next) => {
  console.error('Server error:', err.stack);
  res.status(500).json({
    error: 'Server error',
    message: err.message,
    details: 'Please check server logs for more information'
  });
});

app.use(express.json());

// Health check endpoint
app.get('/health', (req, res) => {
  // Count total cached translations
  let totalCachedTranslations = 0;
  let languageStats = {};
  
  Object.keys(translationCache).forEach(lang => {
    const count = Object.keys(translationCache[lang]).length;
    totalCachedTranslations += count;
    languageStats[lang] = count;
  });
  
  res.json({ 
    status: 'ok',
    apiKeyConfigured: !!CLAUDE_API_KEY && CLAUDE_API_KEY !== 'YOUR_CLAUDE_API_KEY',
    serverTime: new Date().toISOString(),
    cache: {
      totalEntries: totalCachedTranslations,
      languageStats
    }
  });
});

// Simple test endpoint that doesn't require API key
app.get('/test', (req, res) => {
  console.log('Test endpoint called');
  res.json({
    message: 'Server is working properly',
    serverTime: new Date().toISOString()
  });
});

// Simple test translation endpoint that doesn't call Claude
app.post('/test-translate', (req, res) => {
  console.log('Test translation request received:', req.body);
  const { text, targetLang } = req.body;
  
  if (!text) {
    console.error('Missing text in request');
    return res.status(400).json({
      error: 'Missing text parameter',
      received: req.body
    });
  }
  
  console.log(`Translating: "${text}" to ${targetLang}`);
  
  // Just wrap text in brackets to show it was processed
  const translation = `[${targetLang}] ${text}`;
  console.log(`Returning translation: "${translation}"`);
  
  res.json({
    translation: translation,
    processed: true,
    originalText: text,
    targetLang: targetLang
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
    const { text, targetLang, forceRetranslate, styleInfo } = req.body;
    
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
    
    // Check cache first (unless force retranslate is true)
    if (!translationCache[targetLang]) {
      translationCache[targetLang] = {};
    }
    
    // Only use cache for simple translations without style info
    const useCache = !forceRetranslate && !styleInfo && translationCache[targetLang][sanitizedText];
    
    if (useCache) {
      console.log(`Cache hit for "${sanitizedText}" to ${targetLang}`);
      return res.json({ 
        translation: translationCache[targetLang][sanitizedText],
        cached: true,
        originalText: sanitizedText
      });
    }

    if (forceRetranslate) {
      console.log(`Force retranslate requested for "${sanitizedText}" to ${targetLang}`);
    } else {
      console.log(`Cache miss - translating text: "${sanitizedText}" to ${targetLang}`);
    }

    // Determine if we need to include style guidance
    let promptText = '';
    let styleMapping = null;
    
    if (styleInfo && styleInfo.length > 0) {
      console.log(`Translation request includes ${styleInfo.length} style markers`);
      
      // Create a more detailed prompt for Claude that includes style information
      promptText = `Translate the following text to ${targetLang}. 

The text contains styled portions that need special attention. In the original text, these parts have special formatting with specific colors:

${styleInfo.map(style => `- "${style.text}" is styled with color ${style.color}`).join('\n')}

1. First, translate the entire text accurately to ${targetLang}.
2. Then, specify EXACTLY which words or phrases in the translated text should have the same styling as in the original text.

Format your response like this:
TRANSLATION: [your full translation goes here]
STYLING:
- "${styleInfo[0] && styleInfo[0].text}" (${styleInfo[0] && styleInfo[0].color || 'blue'}) → "[equivalent words in translation]"
${styleInfo.length > 1 ? styleInfo.slice(1).map(style => `- "${style.text}" (${style.color}) → "[equivalent words in translation]"`).join('\n') : ''}

IMPORTANT GUIDELINES FOR STYLING:
- For each styled portion, identify the EXACT corresponding words in the translation
- Make sure the styled portions in the translation are meaningful equivalents
- If a style applies to a noun phrase in English, apply it to the complete noun phrase in the translated text
- For Hindi: Pay special attention to word order differences and identify the complete equivalent phrase

Here's the text to translate:

"${sanitizedText}"`;
    } else {
      // Regular translation prompt
      promptText = `Translate the following text to ${targetLang}. Respond with ONLY the translation, no additional context or explanations: "${sanitizedText}"`;
    }

    console.log(`Sending translation request to Claude API for: "${sanitizedText}"`);
    
    // Send request to Claude API
    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': CLAUDE_API_KEY,
          'anthropic-version': '2023-06-01',  // Can be updated to latest API version if needed
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          model: 'claude-3-7-sonnet-20250219',
          max_tokens: 1024,
          messages: [{
            role: 'user',
            content: promptText
          }]
        })
      });
    
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
      
      // Parse the response from Claude
      const responseText = content.text.trim();
      let translatedText = responseText;
      
      // If we sent style info, we need to parse the structured response
      if (styleInfo && styleInfo.length > 0) {
        // Try to extract translation and styling information
        if (responseText.includes('TRANSLATION:') && responseText.includes('STYLING:')) {
          const translationMatch = responseText.match(/TRANSLATION:\s*([\s\S]+?)(?=STYLING:|$)/i);
          const stylingMatch = responseText.match(/STYLING:\s*([\s\S]+?)$/i);
          
          if (translationMatch && translationMatch[1]) {
            translatedText = translationMatch[1].trim();
            console.log(`Extracted translation: "${translatedText.substring(0, 50)}..."`);
            
            // Process style mapping if available
            if (stylingMatch && stylingMatch[1]) {
              const stylingText = stylingMatch[1].trim();
              console.log(`Extracted styling information: "${stylingText.substring(0, 100)}..."`);
              
              // Parse the styling information
              // Format expected: "original text" (color) → "translated text"
              const styleLines = stylingText.split('\n').filter(line => line.includes('→') || line.includes('->'));
              
              if (styleLines.length > 0) {
                styleMapping = styleLines.map(line => {
                  console.log(`Processing style line: "${line}"`);
                  
                  // Extract original text, color, and translated text with improved regex
                  // This handles both quoted and unquoted text, and both → and -> arrows
                  const originalMatch = line.match(/"([^"]+)"/) || line.match(/^[^(]*/);
                  const colorMatch = line.match(/\(([^)]+)\)/);
                  const translatedMatch = line.match(/(?:→|->)\s*"([^"]+)"/) || line.match(/(?:→|->)\s*([^"(][^(]*)/);
                  
                  if (originalMatch && translatedMatch) {
                    const originalText = originalMatch[1] ? originalMatch[1].trim() : originalMatch[0].trim();
                    const translatedText = translatedMatch[1] ? translatedMatch[1].trim() : translatedMatch[0].trim();
                    const color = colorMatch ? colorMatch[1].trim() : "#0000FF"; // Default to blue if color not found
                    
                    console.log(`Mapped style: "${originalText}" -> "${translatedText}" (${color})`);
                    
                    return {
                      originalText: originalText,
                      color: color,
                      translatedText: translatedText
                    };
                  }
                  return null;
                }).filter(item => item !== null);
                
                console.log(`Successfully parsed ${styleMapping.length} style mappings`);
              }
            }
          }
        } else {
          // If Claude didn't follow the format, just use the response as translation
          console.log('Claude response did not follow the expected format, using full response as translation');
        }
      }
      
      // Store in cache
      translationCache[targetLang][sanitizedText] = translatedText;
      console.log(`Translation cached for "${sanitizedText}" to ${targetLang}`);
      console.log(`Original: "${sanitizedText}"`);
      console.log(`Translated: "${translatedText}"`);
      
      // Return the translation and any style mapping
      return res.json({ 
        translation: translatedText,
        cached: false,
        originalText: sanitizedText,
        styleMapping: styleMapping
      });

    } catch (fetchError) {
      console.error('Fetch error:', fetchError);
      throw new Error(`Network error: ${fetchError.message}`);
    }
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

// Add endpoints to manage the cache
app.get('/cache/stats', (req, res) => {
  // Count total cached translations
  let totalCachedTranslations = 0;
  let languageStats = {};
  
  Object.keys(translationCache).forEach(lang => {
    const count = Object.keys(translationCache[lang]).length;
    totalCachedTranslations += count;
    languageStats[lang] = count;
  });
  
  res.json({ 
    totalEntries: totalCachedTranslations,
    byLanguage: languageStats,
    memoryUsageEstimate: JSON.stringify(translationCache).length * 2 + ' bytes'
  });
});

app.delete('/cache', (req, res) => {
  // Clear the entire cache
  Object.keys(translationCache).forEach(lang => {
    delete translationCache[lang];
  });
  
  console.log('Translation cache cleared');
  res.json({ message: 'Cache cleared successfully' });
});

app.delete('/cache/:language', (req, res) => {
  const language = req.params.language;
  
  if (translationCache[language]) {
    delete translationCache[language];
    console.log(`Cache cleared for language: ${language}`);
    res.json({ message: `Cache cleared for language: ${language}` });
  } else {
    res.status(404).json({ message: `No cache found for language: ${language}` });
  }
});

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
      console.log(`Cache endpoints available at:
- GET  http://localhost:${port}/cache/stats - View cache statistics
- DELETE http://localhost:${port}/cache - Clear all cache
- DELETE http://localhost:${port}/cache/:language - Clear cache for a specific language`);
    });
}

// Add ability to write cache to disk and read on startup
const CACHE_FILE = path.join(__dirname, 'translation-cache.json');

// Load cache from disk on startup
try {
  if (fs.existsSync(CACHE_FILE)) {
    const cacheData = fs.readFileSync(CACHE_FILE, 'utf8');
    const loadedCache = JSON.parse(cacheData);
    Object.assign(translationCache, loadedCache);
    console.log(`Loaded ${Object.keys(loadedCache).length} languages from cache file`);
    
    // Count total entries
    let totalEntries = 0;
    Object.keys(translationCache).forEach(lang => {
      totalEntries += Object.keys(translationCache[lang]).length;
    });
    console.log(`Total cached translations: ${totalEntries}`);
  }
} catch (err) {
  console.error('Error loading cache from disk:', err.message);
}

// Save cache to disk periodically (every 5 minutes)
setInterval(() => {
  try {
    // Only save if there's something in the cache
    const totalEntries = Object.values(translationCache)
      .reduce((acc, langCache) => acc + Object.keys(langCache).length, 0);
      
    if (totalEntries > 0) {
      fs.writeFileSync(CACHE_FILE, JSON.stringify(translationCache, null, 2));
      console.log(`Cache saved to disk (${totalEntries} entries)`);
    }
  } catch (err) {
    console.error('Error saving cache to disk:', err.message);
  }
}, 5 * 60 * 1000);

// Save cache on process exit
process.on('SIGINT', () => {
  try {
    fs.writeFileSync(CACHE_FILE, JSON.stringify(translationCache, null, 2));
    console.log('Cache saved to disk before exit');
  } catch (err) {
    console.error('Error saving cache before exit:', err.message);
  }
  process.exit();
});

startServer(PORT);