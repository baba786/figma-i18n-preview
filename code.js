figma.showUI(__html__, { width: 340, height: 400 });

let sourceFrame = null;

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
      throw new Error(`Server responded with ${response.status}`);
    }

    const data = await response.json();
    return data.translation;
  } catch (error) {
    console.error('Translation error:', error);
    throw new Error(`Translation failed: ${error.message}`);
  }
}

async function loadAppropriateFont(targetLang) {
  const fontMappings = {
    'ar': { family: "Dubai", style: "Regular" },
    'zh': { family: "Noto Sans SC", style: "Regular" },
    'ja': { family: "Noto Sans JP", style: "Regular" },
    'ko': { family: "Noto Sans KR", style: "Regular" },
    default: { family: "Inter", style: "Regular" }
  };

  const fontToLoad = fontMappings[targetLang] || fontMappings.default;
  
  try {
    await figma.loadFontAsync(fontToLoad);
    return fontToLoad;
  } catch (error) {
    console.warn(`Failed to load preferred font for ${targetLang}, falling back to Inter`);
    await figma.loadFontAsync({ family: "Inter", style: "Regular" });
    return { family: "Inter", style: "Regular" };
  }
}

async function processTextNodes(node, targetLang) {
  const font = await loadAppropriateFont(targetLang);
  
  if (node.type === "TEXT") {
    try {
      const originalFontSize = node.fontSize;
      const originalFontName = node.fontName;
      
      node.fontName = font;
      
      const originalText = node.characters;
      figma.notify(`Translating: ${originalText}`, { timeout: 1000 });
      const translatedText = await translateText(originalText, targetLang);
      node.characters = translatedText;
      
      node.fontSize = originalFontSize;
      
      if (targetLang === 'ar') {
        node.textAlignHorizontal = 'RIGHT';
        node.textAutoResize = "WIDTH_AND_HEIGHT";
      }
    } catch (error) {
      console.error(`Translation failed for text: ${node.characters}`, error);
      figma.notify(`Failed to translate: ${node.characters}`, { error: true });
    }
  }
  
  if ("children" in node) {
    for (const child of node.children) {
      await processTextNodes(child, targetLang);
    }
  }
}

figma.on('selectionchange', () => {
  const selection = figma.currentPage.selection;
  
  if (selection.length === 1 && selection[0].type === "FRAME") {
    sourceFrame = selection[0];
    const textNodes = [];
    function collectTextNodes(node) {
      if (node.type === "TEXT") {
        textNodes.push(node.characters);
      }
      if ("children" in node) {
        node.children.forEach(collectTextNodes);
      }
    }
    collectTextNodes(sourceFrame);
    
    figma.ui.postMessage({ 
      type: 'frameSelected',
      name: sourceFrame.name,
      textNodes: textNodes
    });
  } else {
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
      await processTextNodes(duplicate, msg.languageCode);
      figma.notify(`✅ Frame translated to ${msg.language}`, { timeout: 2000 });
    } catch (error) {
      figma.notify(`❌ Error during translation: ${error.message}`, { timeout: 3000 });
    }
  }
};