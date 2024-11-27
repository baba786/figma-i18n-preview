figma.showUI(__html__, { width: 340, height: 400 });

let sourceFrame = null;

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
  if (msg.type === 'duplicateFrame') {
    if (!sourceFrame) {
      figma.notify("Please select a frame first");
      return;
    }

    const duplicate = sourceFrame.clone();
    duplicate.x = sourceFrame.x + sourceFrame.width + 100;
    duplicate.y = sourceFrame.y;
    duplicate.name = `${sourceFrame.name} - ${msg.language}`;
    
    figma.notify(`Frame duplicated for ${msg.language}`);
  }
};
