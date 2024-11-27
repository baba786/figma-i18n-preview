figma.showUI(__html__, { width: 340, height: 400 });

figma.on('selectionchange', () => {
  const selection = figma.currentPage.selection;
  if (selection.length === 1 && selection[0].type === 'TEXT') {
    // TODO: Handle text selection
  }
});