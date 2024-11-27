figma.showUI(__html__, { width: 340, height: 400 });

let sourceFrame = null;

// Load the font before making changes
async function loadFonts(node) {
  if (node.type === 'TEXT') {
    await figma.loadFontAsync(node.fontName);
  }
  if ('children' in node) {
    for (const child of node.children) {
      await loadFonts(child);
    }
  }
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

async function translateNode(node, targetLang) {
  // Load fonts before modifying text
  await loadFonts(node);

  if (node.type === "TEXT") {
    try {
      const originalText = node.characters;
      const translatedText = await translateText(originalText, targetLang);
      
      // Store original text as a plugin data
      node.setPluginData('originalText', originalText);
      
      // Update the text
      node.characters = translatedText;
      
      // Handle RTL languages
      if (targetLang === 'ar') {
        node.textAlignHorizontal = 'RIGHT';
      }
      
      // Preserve styles and properties
      if (node.textAutoResize) {
        node.textAutoResize = "WIDTH_AND_HEIGHT";
      }
    } catch (error) {
      console.error(`Failed to translate node: ${node.characters}`, error);
    }
  }
  
  // Recursively translate children
  if ("children" in node) {
    for (const child of node.children) {
      await translateNode(child, targetLang);
    }
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

    try {
      // Clone the frame
      const duplicate = sourceFrame.clone();
      duplicate.x = sourceFrame.x + sourceFrame.width + 100;
      duplicate.y = sourceFrame.y;
      duplicate.name = `${sourceFrame.name} - ${msg.language}`;

      // Translate all text nodes in the duplicated frame
      await translateNode(duplicate, msg.languageCode);

      figma.notify(`✅ Frame translated to ${msg.language}`, { timeout: 2000 });
      
      // Select the newly created frame
      figma.currentPage.selection = [duplicate];
      
      // Optional: Zoom to the new frame
      figma.viewport.scrollAndZoomIntoView([duplicate]);
      
    } catch (error) {
      figma.notify(`❌ Error during translation: ${error.message}`, { timeout: 3000 });
    }
  }
};

// Check initial selection
const initialSelection = figma.currentPage.selection;
if (initialSelection.length === 1 && initialSelection[0].type === "FRAME") {
  sourceFrame = initialSelection[0];
  figma.ui.postMessage({ 
    type: 'frameSelected',
    name: sourceFrame.name
  });
}