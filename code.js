figma.showUI(__html__, { width: 340, height: 400 });

let sourceFrame = null;
let translationInProgress = false;

// Wrapper for translateNode with better error handling
async function safeTranslateNode(node, targetLang, totalNodes, filterSettings, currentNode = { count: 0 }) {
  try {
    await translateNode(node, targetLang, totalNodes, filterSettings, currentNode);
  } catch (error) {
    console.error(`Critical error in translation process: ${error.message}`);
    console.error(error.stack);
    figma.notify(`Critical error: ${error.message}. Check console logs.`, { error: true, timeout: 10000 });
  }
}

async function translateNode(node, targetLang, totalNodes, filterSettings = {}, currentNode = { count: 0 }) {
  // Skip non-TEXT nodes immediately
  if (node && node.type !== "TEXT" && node.type !== "GROUP" && node.type !== "FRAME" && !node.children) {
    return; // Skip images, vectors, shapes, etc.
  }
  if (!node) {
    console.log('Skipping null node');
    return;
  }

  try {
    // Skip invisible nodes and locked nodes
    if (node.visible === false || node.locked === true) {
      console.log('Skipping invisible or locked node');
      return;
    }

    if (node.type === "TEXT") {
      try {
        // Verify node has valid font before proceeding
        if (!node.fontName) {
          console.log('Skipping node without font');
          return;
        }

        await figma.loadFontAsync(node.fontName);
        
        // Safely get original text
        const originalText = node.characters || '';
        
        // Enhanced validation for text content
        if (!originalText || 
            typeof originalText !== 'string' || 
            originalText.trim() === '' || 
            originalText.length <= 1) {
          console.log('Skipping invalid text content:', originalText);
          return;
        }

        // Skip UI elements and common patterns to ignore
        if (/^[0-9:.]$/.test(originalText) || 
            /^(search|menu|close|back|\d+:\d+)$/i.test(originalText) ||
            /^[\s\u200B-\u200D\uFEFF\u00A0]*$/.test(originalText)) {
          console.log('Skipping UI element text:', originalText);
          return;
        }

        // Skip emails, URLs, and code blocks if enabled
        if (filterSettings.skipURLsEmails !== false && 
            (/^[\w.-]+@[\w.-]+\.\w+$/.test(originalText) || 
             /^https?:\/\//.test(originalText) ||
             /[{};<>]/.test(originalText))) {
          console.log('Skipping URL/email/code:', originalText);
          return;
        }
        
        // Skip dates and timestamps if enabled
        if (filterSettings.skipDates !== false && 
            (/^\d{1,2}[-\/]\d{1,2}[-\/]\d{2,4}$/.test(originalText) ||
             /^\d{1,2}:\d{2}(:\d{2})?(\s?[AP]M)?$/.test(originalText))) {
          console.log('Skipping date/time:', originalText);
          return;
        }
        
        // Skip placeholders if enabled
        if (filterSettings.skipPlaceholders !== false && 
            /placeholder|dummy|lorem ipsum|sample|text here/i.test(originalText)) {
          console.log('Skipping placeholder text:', originalText);
          return;
        }

        // Safe parent name check
        let skipNode = false;
        try {
          // Check if parent is a component instance (if enabled)
          if (filterSettings.skipInstances !== false && node.parent && node.parent.type === "INSTANCE") {
            console.log('Skipping text in component instance');
            skipNode = true;
          }
          
          // Check parent name for UI components (if enabled)
          if (filterSettings.skipUiElements !== false && node.parent && typeof node.parent.name === 'string') {
            const parentName = node.parent.name.toLowerCase();
            if (parentName.includes('search') || 
                parentName.includes('button') || 
                parentName.includes('icon') ||
                parentName.includes('menu') ||
                parentName.includes('nav') ||
                parentName.includes('tab') ||
                parentName.includes('toggle') ||
                parentName.includes('checkbox') ||
                parentName.includes('radio') ||
                parentName.includes('input') ||
                parentName.includes('slider') ||
                parentName.includes('switch') ||
                parentName.includes('tooltip') ||
                parentName.includes('badge') ||
                parentName.includes('logo')) {
              console.log('Skipping UI element with parent:', parentName);
              skipNode = true;
            }
          }
        } catch (parentError) {
          console.log('Error checking parent, continuing with node');
        }

        if (skipNode) return;

        // Sanitize text
        const sanitizedText = originalText
          .replace(/[\u0000-\u001F\u007F-\u009F]/g, '')
          .replace(/\s+/g, ' ')
          .trim();

        if (!sanitizedText) {
          console.log('Empty text after sanitization');
          return;
        }

        currentNode.count++;
        const progress = Math.round((currentNode.count / totalNodes) * 100);

        // Translation request without AbortController (which is not supported)
        try {
          const response = await fetch('http://localhost:3000/translate', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              text: sanitizedText,
              targetLang
            })
          });

          if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
          }

          const data = await response.json();
          
          if (!data || !data.translation) {
            console.log('No translation received for:', sanitizedText);
            return;
          }

          // Update text and notify progress
          node.characters = data.translation;
          figma.ui.postMessage({ 
            type: 'translationProgress',
            progress,
            originalText: sanitizedText,
            translatedText: data.translation
          });

        } catch (fetchError) {
          console.error('Translation request failed:', fetchError.message);
          throw fetchError;
        }

      } catch (nodeError) {
        console.error('Error processing text node:', nodeError.message);
        // Continue with other nodes
      }
    }

    // Process children if they exist and are valid
    if (node.children && Array.isArray(node.children)) {
      for (const child of node.children) {
        if (child) {
          await translateNode(child, targetLang, totalNodes, filterSettings, currentNode);
        }
      }
    }

  } catch (error) {
    console.error('Unexpected error in translateNode:', error.message);
  }
}

// Count total text nodes with safer access
function countTextNodes(node) {
  try {
    let count = 0;
    if (node && node.type === "TEXT") {
      // Only count non-empty text nodes
      if (node.characters && node.characters.trim().length > 0) {
        count++;
      }
    }
    if (node && node.children && Array.isArray(node.children)) {
      for (const child of node.children) {
        if (child) {
          count += countTextNodes(child);
        }
      }
    }
    return count;
  } catch (e) {
    console.error(`Error counting nodes: ${e.message}`);
    return 0;
  }
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
      console.log(`Total text nodes to translate: ${totalTextNodes}`);
      
      if (totalTextNodes === 0) {
        figma.notify('No text nodes found in the selected frame', { timeout: 3000 });
        translationInProgress = false;
        figma.ui.postMessage({ type: 'translationComplete' });
        return;
      }
      
      try {
        // Start translation using the safer wrapper
        await safeTranslateNode(duplicate, msg.languageCode, totalTextNodes, msg.filterSettings || {});
        
        // Complete notification
        figma.notify(`✅ Frame translated to ${msg.language}`, { timeout: 2000 });
      } catch (translationError) {
        console.error('Translation process error:', translationError);
        figma.notify(`❌ Some translations may not be complete: ${translationError.message}`, 
          { error: true, timeout: 5000 });
      }
      
      // Select the new frame - do this even if some translations failed
      figma.currentPage.selection = [duplicate];
      figma.viewport.scrollAndZoomIntoView([duplicate]);
    } catch (error) {
      console.error('Critical error:', error);
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

// Add validation before sending text for translation
async function translateTextNode(node) {
  // Skip empty or undefined text
  if (!node || !node.characters || node.characters.trim() === '') {
    console.log('Skipping empty text node');
    return;
  }

  try {
    // Using basic fetch without timeout control
    const response = await fetch('http://localhost:3000/translate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text: node.characters,
        targetLang: selectedLanguage // Make sure this is defined
      })
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    if (data.translation) {
      node.characters = data.translation;
    } else {
      console.warn('No translation received for:', node.characters);
    }
  } catch (error) {
    console.error('Translation error:', error);
    throw error;
  }
}

// When processing multiple nodes, add validation
async function translateSelection() {
  const nodes = figma.currentPage.selection;
  
  for (const node of nodes) {
    if (node.type === "TEXT") {
      try {
        await translateTextNode(node);
      } catch (error) {
        console.error(`Error translating node "${node.characters}":`, error);
        // Continue with other nodes instead of breaking
        continue;
      }
    }
  }
}
