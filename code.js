figma.showUI(__html__, { width: 340, height: 400 });

let sourceFrame = null;
let translationInProgress = false;

// Check initial selection and send message to UI
const initialSelection = figma.currentPage.selection;
if (initialSelection.length === 1 && initialSelection[0].type === "FRAME") {
  sourceFrame = initialSelection[0];
  figma.ui.postMessage({ 
    type: 'frameSelected',
    name: sourceFrame.name
  });
}

// Create loading indicator
async function createLoadingOverlay(frame) {
  const bg = figma.createRectangle();
  bg.resize(frame.width, frame.height);
  bg.x = frame.x;
  bg.y = frame.y;
  bg.fills = [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 }, opacity: 0.95 }];
  bg.name = 'Translation Background';

  const loadingContainer = figma.createFrame();
  loadingContainer.resize(200, 80);
  loadingContainer.x = frame.x + (frame.width - 200) / 2;
  loadingContainer.y = frame.y + (frame.height - 80) / 2;
  loadingContainer.fills = [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }];
  loadingContainer.cornerRadius = 8;
  loadingContainer.effects = [{
    type: 'DROP_SHADOW',
    color: { r: 0, g: 0, b: 0, a: 0.1 },
    offset: { x: 0, y: 2 },
    radius: 4,
    spread: 0
  }];

  const loadingText = figma.createText();
  await figma.loadFontAsync({ family: "Inter", style: "Regular" });
  loadingText.characters = 'Translating...';
  loadingText.fontSize = 14;
  loadingText.x = 20;
  loadingText.y = 20;

  const progressText = figma.createText();
  await figma.loadFontAsync({ family: "Inter", style: "Regular" });
  progressText.characters = '0%';
  progressText.fontSize = 12;
  progressText.fills = [{ type: 'SOLID', color: { r: 0.4, g: 0.4, b: 0.4 } }];
  progressText.x = 20;
  progressText.y = 45;

  loadingContainer.appendChild(loadingText);
  loadingContainer.appendChild(progressText);

  const group = figma.group([bg, loadingContainer], frame.parent);
  group.name = 'Translation Loading';
  
  return { group, progressText };
}

async function updateLoadingProgress(progressText, percent) {
  progressText.characters = `${percent}% Complete`;
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

async function translateNode(node, targetLang, totalNodes, currentNode = { count: 0 }, loadingUI) {
  await loadFonts(node);

  if (node.type === "TEXT") {
    try {
      currentNode.count++;
      const progress = Math.round((currentNode.count / totalNodes) * 100);
      
      await updateLoadingProgress(loadingUI.progressText, progress);
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
      await translateNode(child, targetLang, totalNodes, currentNode, loadingUI);
    }
  }
}

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

figma.ui.onmessage = async (msg) => {
  if (msg.type === 'translateFrame' && !translationInProgress) {
    if (!sourceFrame) {
      figma.notify("Please select a frame first");
      return;
    }

    translationInProgress = true;
    let loadingUI = null;
    
    try {
      const duplicate = sourceFrame.clone();
      duplicate.x = sourceFrame.x + sourceFrame.width + 100;
      duplicate.y = sourceFrame.y;
      duplicate.name = `${sourceFrame.name} - ${msg.language}`;

      loadingUI = await createLoadingOverlay(duplicate);
      
      const totalTextNodes = countTextNodes(duplicate);
      
      figma.ui.postMessage({ 
        type: 'translationStarted',
        totalNodes: totalTextNodes
      });

      await translateNode(duplicate, msg.languageCode, totalTextNodes, { count: 0 }, loadingUI);

      loadingUI.group.remove();
      
      figma.notify(`✅ Frame translated to ${msg.language}`, { timeout: 2000 });
      figma.currentPage.selection = [duplicate];
      figma.viewport.scrollAndZoomIntoView([duplicate]);
      
    } catch (error) {
      if (loadingUI) loadingUI.group.remove();
      figma.notify(`❌ Error during translation: ${error.message}`, { timeout: 3000 });
    } finally {
      translationInProgress = false;
      figma.ui.postMessage({ type: 'translationComplete' });
    }
  }
};