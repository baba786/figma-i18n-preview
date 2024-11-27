figma.showUI(__html__, { width: 340, height: 400 });

let sourceFrame = null;
let translationInProgress = false;

// Create a loading indicator rectangle
async function createLoadingOverlay(frame) {
  const overlay = figma.createRectangle();
  overlay.resize(frame.width, frame.height);
  overlay.x = frame.x;
  overlay.y = frame.y;
  overlay.fills = [{ type: 'SOLID', color: { r: 0.9, g: 0.9, b: 0.9 }, opacity: 0.5 }];
  overlay.name = 'Loading Overlay';
  
  // Create loading text
  const loadingText = figma.createText();
  await figma.loadFontAsync({ family: "Inter", style: "Regular" });
  loadingText.characters = 'Translating...';
  loadingText.x = frame.x + (frame.width - loadingText.width) / 2;
  loadingText.y = frame.y + (frame.height - loadingText.height) / 2;
  
  // Group the overlay and text
  const group = figma.group([overlay, loadingText], frame.parent);
  group.name = 'Translation Loading';
  
  return group;
}

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

async function translateText(text, targetLang) {
  try {
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
    throw error;
  }
}

async function translateNode(node, targetLang, totalNodes, currentNode = { count: 0 }) {
  await loadFonts(node);

  if (node.type === "TEXT") {
    try {
      currentNode.count++;
      const progress = Math.round((currentNode.count / totalNodes) * 100);
      
      // Update progress in UI
      figma.ui.postMessage({ 
        type: 'translationProgress',
        progress,
        currentText: node.characters
      });

      const originalText = node.characters;
      const translatedText = await translateText(originalText, targetLang);
      
      node.setPluginData('originalText', originalText);
      node.characters = translatedText;
      
      if (targetLang === 'ar') {
        node.textAlignHorizontal = 'RIGHT';
      }
      
      if (node.textAutoResize) {
        node.textAutoResize = "WIDTH_AND_HEIGHT";
      }

      // Notify UI of successful translation
      figma.ui.postMessage({ 
        type: 'nodeTranslated',
        originalText,
        translatedText,
        progress
      });
    } catch (error) {
      console.error(`Failed to translate node: ${node.characters}`, error);
      figma.ui.postMessage({ 
        type: 'translationError',
        text: node.characters,
        error: error.message
      });
    }
  }
  
  if ("children" in node) {
    for (const child of node.children) {
      await translateNode(child, targetLang, totalNodes, currentNode);
    }
  }
}

// Count total text nodes in a frame
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

figma.ui.onmessage = async (msg) => {
  if (msg.type === 'translateFrame' && !translationInProgress) {
    if (!sourceFrame) {
      figma.notify("Please select a frame first");
      return;
    }

    translationInProgress = true;
    
    try {
      const duplicate = sourceFrame.clone();
      duplicate.x = sourceFrame.x + sourceFrame.width + 100;
      duplicate.y = sourceFrame.y;
      duplicate.name = `${sourceFrame.name} - ${msg.language}`;

      // Create and show loading overlay
      const loadingOverlay = await createLoadingOverlay(duplicate);
      
      // Count total text nodes for progress tracking
      const totalTextNodes = countTextNodes(duplicate);
      
      // Start translation
      figma.ui.postMessage({ 
        type: 'translationStarted',
        totalNodes: totalTextNodes
      });

      await translateNode(duplicate, msg.languageCode, totalTextNodes);

      // Remove loading overlay
      loadingOverlay.remove();
      
      // Final notification
      figma.notify(`✅ Frame translated to ${msg.language}`, { timeout: 2000 });
      figma.currentPage.selection = [duplicate];
      figma.viewport.scrollAndZoomIntoView([duplicate]);
      
    } catch (error) {
      figma.notify(`❌ Error during translation: ${error.message}`, { timeout: 3000 });
    } finally {
      translationInProgress = false;
      figma.ui.postMessage({ type: 'translationComplete' });
    }
  }
};

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

// Check initial selection
const initialSelection = figma.currentPage.selection;
if (initialSelection.length === 1 && initialSelection[0].type === "FRAME") {
  sourceFrame = initialSelection[0];
  figma.ui.postMessage({ 
    type: 'frameSelected',
    name: sourceFrame.name
  });
}