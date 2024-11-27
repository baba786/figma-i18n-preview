figma.showUI(__html__, { width: 340, height: 400 });

let sourceFrame = null;

const translations = {
  "es": {
    "Hello": "Hola",
    "Welcome": "Bienvenidos",
    "Submit": "Enviar",
    "Cancel": "Cancelar",
    "Next": "Siguiente",
    "Back": "Atrás"
  }
};

async function processTextNodes(node, targetLang) {
  await figma.loadFontAsync({ family: "Inter", style: "Regular" });
  
  if (node.type === "TEXT") {
    const originalText = node.characters;
    if (translations[targetLang] && translations[targetLang][originalText]) {
      node.characters = translations[targetLang][originalText];
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
  if (msg.type === 'translateFrame') {
    if (!sourceFrame) {
      figma.notify("Please select a frame first");
      return;
    }

    figma.notify(`Creating ${msg.language} version...`);

    const duplicate = sourceFrame.clone();
    duplicate.x = sourceFrame.x + sourceFrame.width + 100;
    duplicate.y = sourceFrame.y;
    duplicate.name = `${sourceFrame.name} - ${msg.language}`;
    
    try {
      await processTextNodes(duplicate, msg.languageCode);
      figma.notify(`✅ Frame translated to ${msg.language}`);
    } catch (error) {
      figma.notify(`❌ Error during translation: ${error.message}`);
    }
  }
};