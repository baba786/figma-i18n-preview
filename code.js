figma.showUI(__html__, { width: 340, height: 400 });

let sourceFrame = null;

async function checkServer() {
  try {
    const response = await fetch('http://localhost:3000/health');
    return response.ok;
  } catch (error) {
    return false;
  }
}

async function translateText(text, targetLang) {
  try {
    // Check server status first
    const serverRunning = await checkServer();
    if (!serverRunning) {
      throw new Error('Translation server is not running. Please start the proxy server.');
    }

    const response = await fetch('http://localhost:3000/translate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text,
        targetLang
      })
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || `Server responded with ${response.status}`);
    }

    const data = await response.json();
    return data.translation;
  } catch (error) {
    console.error('Translation error:', error);
    throw new Error(`Translation failed: ${error.message}`);
  }
}

// Rest of the code remains the same
