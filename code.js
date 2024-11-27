figma.showUI(__html__, { width: 340, height: 400 });

let sourceFrame = null;
let translationInProgress = false;

async function translateNode(node, targetLang, totalNodes, currentNode = { count: 0 }) {
  try {
    if (node.type === "TEXT") {
      // Load font before modifying text
      await figma.loadFontAsync(node.fontName);
      
      currentNode.count++;
      const progress = Math.round((currentNode.count / totalNodes) * 100);
      
      const originalText = node.characters;
      console.log('Processing text node:', originalText);
      
      // Send translation request
      const response = await fetch('http://localhost:3000/translate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text: originalText,
          targetLang
        })
      });

      if (!response.ok) {
        throw new Error(`Translation request failed: ${response.status}`);
      }

      const data = await response.json();
      const translatedText = data.translation;
      
      // Store original text
      node.setPluginData('originalText', originalText);
      
      // Update text with translation
      node.characters = translatedText;
      
      // Handle RTL languages
      if (targetLang === 'ar') {
        node.textAlignHorizontal = 'RIGHT';
      }
      
      // Update progress
      figma.ui.postMessage({ 
        type: 'translationProgress',
        progress,
        originalText,
        translatedText
      });
    }
    
    // Process children if they exist
    if ("children" in node) {
      for (const child of node.children) {
        await translateNode(child, targetLang, totalNodes, currentNode);
      }
    }
  } catch (error) {
    console.error(`Translation error: ${error.message}`);
    figma.notify(`Error translating "${node.characters}": ${error.message}`, { error: true });
  }
}

// Count total text nodes
function countTextNodes(node) {
  let count = 0;
  if (node.type === "TEXT") count++;
  if ("children" in node) {
    for (const child of node.children) {
      count += countTextNodes(child);
    }
  }
  return count;
}

// Selection change handler
figma.on('selectionchange', () => {
  const selection = figma.currentPage.selection;
  if (selection.length === 1 && selection[0].type === "FRAME") {
    sourceFrame = selection[0];
    figma.ui.postMessage({ 
      type: 'frameSelected',
      name: sourceFrame.name
    });
  } else {
    sourceFrame = null;
    figma.ui.postMessage({ 
      type: 'noFrameSelected'
    });
  }
});

// Message handler
figma.ui.onmessage = async (msg) => {
  if (msg.type === 'translateFrame' && !translationInProgress) {
    if (!sourceFrame) {
      figma.notify("Please select a frame first");
      return;
    }

    translationInProgress = true;
    figma.ui.postMessage({ type: 'translationStarted' });
    
    try {
      // Clone the frame
      const duplicate = sourceFrame.clone();
      duplicate.x = sourceFrame.x + sourceFrame.width + 100;
      duplicate.y = sourceFrame.y;
      duplicate.name = `${sourceFrame.name} - ${msg.language}`;
      
      // Count total text nodes for progress tracking
      const totalTextNodes = countTextNodes(duplicate);
      
      // Start translation
      await translateNode(duplicate, msg.languageCode, totalTextNodes);
      
      // Complete notification
      figma.notify(`✅ Frame translated to ${msg.language}`, { timeout: 2000 });
      
      // Select the new frame
      figma.currentPage.selection = [duplicate];
      figma.viewport.scrollAndZoomIntoView([duplicate]);
    } catch (error) {
      figma.notify(`❌ Translation failed: ${error.message}`, { error: true });
    } finally {
      translationInProgress = false;
      figma.ui.postMessage({ type: 'translationComplete' });
    }
  }
};

// Initial selection check
const initialSelection = figma.currentPage.selection;
if (initialSelection.length === 1 && initialSelection[0].type === "FRAME") {
  sourceFrame = initialSelection[0];
  figma.ui.postMessage({ 
    type: 'frameSelected',
    name: sourceFrame.name
  });
}