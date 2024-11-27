figma.showUI(__html__, { width: 340, height: 400 });

let sourceFrame = null;

// Immediately check for selection when plugin starts
const initialSelection = figma.currentPage.selection;
if (initialSelection.length === 1 && initialSelection[0].type === "FRAME") {
  sourceFrame = initialSelection[0];
  figma.ui.postMessage({ 
    type: 'frameSelected',
    name: sourceFrame.name
  });
}

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
    const serverRunning = await checkServer();
    if (!serverRunning) {
      throw new Error('Translation server is not running. Please start the proxy server.');
    }

    console.log('Sending translation request for:', text, 'to language:', targetLang);

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
    console.log('Received translation:', data.translation);
    return data.translation;
  } catch (error) {
    console.error('Translation error:', error);
    figma.notify(`Translation failed: ${error.message}`, { error: true });
    throw error;
  }
}

figma.on('selectionchange', () => {
  console.log('Selection changed');
  const selection = figma.currentPage.selection;
  
  if (selection.length === 1 && selection[0].type === "FRAME") {
    console.log('Frame selected:', selection[0].name);
    sourceFrame = selection[0];
    figma.ui.postMessage({ 
      type: 'frameSelected',
      name: sourceFrame.name
    });
  } else {
    console.log('No frame selected or multiple items selected');
    sourceFrame = null;
    figma.ui.postMessage({ 
      type: 'noFrameSelected'
    });
  }
});

figma.ui.onmessage = async (msg) => {
  if (msg.type === 'translateFrame') {
    if (!sourceFrame) {
      figma.notify("Please select a frame first");
      return;
    }

    figma.notify(`Creating ${msg.language} version...`, { timeout: 2000 });

    const duplicate = sourceFrame.clone();
    duplicate.x = sourceFrame.x + sourceFrame.width + 100;
    duplicate.y = sourceFrame.y;
    duplicate.name = `${sourceFrame.name} - ${msg.language}`;
    
    try {
      // Find all text nodes in the duplicated frame
      const textNodes = [];
      function findTextNodes(node) {
        if (node.type === "TEXT") {
          textNodes.push(node);
        }
        if ("children" in node) {
          for (const child of node.children) {
            findTextNodes(child);
          }
        }
      }
      findTextNodes(duplicate);

      // Process each text node
      for (const node of textNodes) {
        try {
          const originalText = node.characters;
          console.log('Processing text node:', originalText);
          const translatedText = await translateText(originalText, msg.languageCode);
          node.characters = translatedText;

          // Handle RTL languages
          if (msg.languageCode === 'ar') {
            node.textAlignHorizontal = 'RIGHT';
          }
        } catch (error) {
          console.error(`Failed to translate text: ${node.characters}`, error);
        }
      }

      figma.notify(`✅ Frame translated to ${msg.language}`, { timeout: 2000 });
    } catch (error) {
      figma.notify(`❌ Error during translation: ${error.message}`, { timeout: 3000 });
    }
  }
};