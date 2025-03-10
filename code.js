// ====================
// Show UI
// ====================

// Global flag for Claude-based styling
let useClaudeStylingForTranslations = false;

// Language-specific expansion factors (approximate percentages)
const EXPANSION_FACTORS = {
  'es': 1.3,  // Spanish ~30% longer than English
  'fr': 1.25, // French ~25% longer
  'de': 1.3,  // German ~30% longer
  'ru': 1.2,  // Russian ~20% longer
  'it': 1.25, // Italian ~25% longer
  'pt': 1.2,  // Portuguese ~20% longer
  'hi': 1.0,  // Hindi similar to English in length
  'ja': 0.6,  // Japanese typically shorter (character-based)
  'zh': 0.5,  // Chinese typically shorter (character-based)
  'ar': 1.25, // Arabic ~25% longer
  // Default for other languages
  'default': 1.2
};
figma.showUI(__html__, { width: 340, height: 500 });

// ====================
// Global error handling, server checks, etc.
// ====================

// Enhanced server connectivity check with better debugging
async function checkServerConnectivity() {
  console.log('[SERVER] 🔌 Checking server connectivity...');
  
  try {
    // First try the health endpoint
    console.log('[SERVER] 🔌 Testing health endpoint...');
    const healthResponse = await fetch('http://localhost:3000/health', {
      method: 'GET',
      headers: { 'Accept': 'application/json' }
    });
    
    if (healthResponse.ok) {
      const healthData = await healthResponse.json();
      console.log('[SERVER] ✅ Health endpoint responded:', healthData);
      return true;
    }
    
    console.log('[SERVER] ⚠️ Health endpoint failed, trying test endpoint...');
    
    // Fallback to test endpoint
    const testResponse = await fetch('http://localhost:3000/test', {
      method: 'GET',
      headers: { 'Accept': 'application/json' }
    });
    
    if (testResponse.ok) {
      const testData = await testResponse.json();
      console.log('[SERVER] ✅ Test endpoint responded:', testData);
      return true;
    }
    
    console.log('[SERVER] ❌ Test endpoint also failed');
    return false;
  } catch (error) {
    console.error('[SERVER] ❌ Server connectivity check failed:', error);
    return false;
  }
}

// Run connectivity check
checkServerConnectivity();

// Set timeout for plugin operations (5 minutes)
let translationInProgress = false;
setTimeout(() => {
  if (translationInProgress) {
    figma.notify('Operation timed out. Please try again with a smaller selection.', { error: true });
    translationInProgress = false;
    figma.ui.postMessage({ type: 'translationComplete' });
  }
}, 300000); // 5 minutes

let sourceFrame = null;

/*****************************************************
 * STYLE RANGE PRESERVATION HELPERS
 *****************************************************/

function getTextStyleRanges(node) {
  const ranges = [];
  const totalLength = node.characters.length;
  let rangeStart = 0;

  while (rangeStart < totalLength) {
    const fontName = node.getRangeFontName(rangeStart, rangeStart + 1);
    const fontSize = node.getRangeFontSize(rangeStart, rangeStart + 1);
    const fills = node.getRangeFills(rangeStart, rangeStart + 1);
    const letterSpacing = node.getRangeLetterSpacing(rangeStart, rangeStart + 1);
    const lineHeight = node.getRangeLineHeight(rangeStart, rangeStart + 1);
    const textCase = node.getRangeTextCase(rangeStart, rangeStart + 1);
    const textDecoration = node.getRangeTextDecoration(rangeStart, rangeStart + 1);

    let rangeEnd = rangeStart + 1;
    while (rangeEnd < totalLength) {
      const nextFontName = node.getRangeFontName(rangeEnd, rangeEnd + 1);
      const nextFontSize = node.getRangeFontSize(rangeEnd, rangeEnd + 1);
      const nextFills = node.getRangeFills(rangeEnd, rangeEnd + 1);
      const nextLetterSpacing = node.getRangeLetterSpacing(rangeEnd, rangeEnd + 1);
      const nextLineHeight = node.getRangeLineHeight(rangeEnd, rangeEnd + 1);
      const nextTextCase = node.getRangeTextCase(rangeEnd, rangeEnd + 1);
      const nextTextDecoration = node.getRangeTextDecoration(rangeEnd, rangeEnd + 1);

      if (
        JSON.stringify(fontName) === JSON.stringify(nextFontName) &&
        JSON.stringify(fontSize) === JSON.stringify(nextFontSize) &&
        JSON.stringify(fills) === JSON.stringify(nextFills) &&
        JSON.stringify(letterSpacing) === JSON.stringify(nextLetterSpacing) &&
        JSON.stringify(lineHeight) === JSON.stringify(nextLineHeight) &&
        textCase === nextTextCase &&
        textDecoration === nextTextDecoration
      ) {
        rangeEnd++;
      } else {
        break;
      }
    }

    ranges.push({
      start: rangeStart,
      end: rangeEnd,
      text: node.characters.substring(rangeStart, rangeEnd),
      fontName,
      fontSize,
      fills,
      letterSpacing,
      lineHeight,
      textCase,
      textDecoration
    });

    rangeStart = rangeEnd;
  }

  return ranges;
}

async function loadRunFont(run) {
  try {
    if (run.fontName && typeof run.fontName === 'object') {
      await figma.loadFontAsync(run.fontName);
    }
  } catch (err) {
    console.warn('Could not load run font:', run.fontName, err);
    await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });
  }
}

async function applyTextStyleRanges(node, styleRanges, newText) {
  node.characters = newText;

  if (!styleRanges || styleRanges.length === 0) return;

  if (styleRanges.length === 1) {
    const r = styleRanges[0];
    await loadRunFont(r);
    node.setRangeFontName(0, newText.length, r.fontName);
    node.setRangeFontSize(0, newText.length, r.fontSize);
    node.setRangeFills(0, newText.length, r.fills);
    node.setRangeLetterSpacing(0, newText.length, r.letterSpacing);
    node.setRangeLineHeight(0, newText.length, r.lineHeight);
    node.setRangeTextCase(0, newText.length, r.textCase);
    node.setRangeTextDecoration(0, newText.length, r.textDecoration);
  } else {
    const first = styleRanges[0];
    await loadRunFont(first);
    node.setRangeFontName(0, newText.length, first.fontName);
    node.setRangeFontSize(0, newText.length, first.fontSize);
    node.setRangeFills(0, newText.length, first.fills);
    node.setRangeLetterSpacing(0, newText.length, first.letterSpacing);
    node.setRangeLineHeight(0, newText.length, first.lineHeight);
    node.setRangeTextCase(0, newText.length, first.textCase);
    node.setRangeTextDecoration(0, newText.length, first.textDecoration);
  }
}

/*****************************************************
 * NEW AND UPDATED HELPERS
 *****************************************************/

// Enhanced list detection with multi-language support
function detectAndFormatBulletList(text) {
  // Comprehensive bullet pattern detection (works for multiple languages)
  const bulletPatterns = [
    /^\s*[•⁃⁌⁍∙◦≡→⟐◆◇⬧⦿⦾■□☐☑✓✔✕✗✘☓☒⊗⊠]/, // Common bullet symbols
    /^\s*[-*+]/,                            // ASCII bullets
    /^\s*\d+[\.\)]$/,                       // Numbered lists
    /^\s*[a-zа-яα-ωא-ת一-龯][\.\)]$/i        // Lettered lists (multi-language)
  ];
  
  // Split by line breaks and filter empty lines
  const lines = text.split('\n').filter(line => line.trim());
  
  // Determine if this is a list (more than one line and at least one bullet)
  const isBulletList = lines.length > 1 && 
                      lines.some(line => bulletPatterns.some(pattern => pattern.test(line.trim())));
  
  if (!isBulletList) {
    return {
      isBulletList: false,
      items: [text],
      bulletChars: []
    };
  }
  
  // Extract bullet characters and text content
  const items = [];
  const bulletChars = [];
  const cleanItems = [];

  for (const line of lines) {
    const trimmedLine = line.trim();
    let bulletChar = '';
    let cleanItem = trimmedLine;
    
    // Find bullet character if present
    for (const pattern of bulletPatterns) {
      const match = trimmedLine.match(pattern);
      if (match) {
        bulletChar = match[0];
        cleanItem = trimmedLine.replace(pattern, '').trim();
        break;
      }
    }
    
    items.push(trimmedLine);
    bulletChars.push(bulletChar);
    cleanItems.push(cleanItem);
  }
  
  return {
    isBulletList: true,
    items: items,
    cleanItems: cleanItems,
    bulletChars: bulletChars
  };
}

// More advanced list treatment
async function translateListItems(listInfo, targetLang) {
  // We need to translate each language name separately to maintain the list structure
  const individualTranslationItems = [];
  const bulletChar = '• ';
  
  for (const cleanItem of listInfo.cleanItems) {
    if (!cleanItem.trim()) continue;
    
    try {
      const response = await fetch('http://localhost:3000/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: cleanItem, targetLang })
      });
      
      const data = await response.json();
      individualTranslationItems.push(data.translation);
    } catch (error) {
      console.error('Error translating list item:', error);
      individualTranslationItems.push(cleanItem); // Fallback to original
    }
  }
  
  // If we get a concatenated result, split it back into separate items
  if (individualTranslationItems.length === 1 && individualTranslationItems[0].includes(',')) {
    // The translation system likely merged everything - let's split it back up
    const parts = individualTranslationItems[0]
      .split(/[,\n]/) // Split by commas or newlines
      .map(part => part.trim())
      .filter(part => part.length > 0);
      
    if (parts.length > 1) {
      return parts.map(part => `${bulletChar}${part}`).join('\n');
    }
  }
  
  // Explicitly format each item with its own bullet point
  return individualTranslationItems
    .map(item => `${bulletChar}${item}`)
    .join('\n');
}

async function checkTextOverflow(node, translatedText, fontToUse, isRTL) {
  const clone = node.clone();
  clone.visible = false;
  figma.currentPage.appendChild(clone);

  try {
    if (isRTL) {
      await loadNonLatinFonts(clone, 'ar');
      fontToUse = clone.fontName;
    } else {
      await figma.loadFontAsync(fontToUse);
    }

    clone.setRangeFontName(0, clone.characters.length, fontToUse);
    clone.characters = translatedText;

    const overflows = {
      width: clone.textAutoResize !== "WIDTH_AND_HEIGHT" && clone.width > node.width,
      height: clone.textAutoResize !== "HEIGHT" && clone.height > node.height
    };

    if (overflows.width || overflows.height) {
      console.warn(`Text overflow detected in "${node.name}": Width: ${overflows.width}, Height: ${overflows.height}`);
      node.strokes = [{ type: "SOLID", color: { r: 1, g: 0, b: 0 } }];
      return true;
    }
    return false;
  } catch (error) {
    console.error('Error in overflow check:', error);
    return false;
  } finally {
    clone.remove();
  }
}

/*****************************************************
 * EXISTING HELPERS (UPDATED WHERE NEEDED)
 *****************************************************/

async function safeTranslateNode(node, targetLang, totalNodes = 0, filterSettings = {}, currentNode = null, forceRetranslate = false, preserveStyles = true) {
  try {
    return await translateNode(
      node, 
      targetLang, 
      totalNodes, 
      filterSettings, 
      currentNode || { count: 0 }, 
      forceRetranslate,
      preserveStyles
    );
  } catch (error) {
    console.error('Translation error:', error);
    return false;
  }
}

function createFallbackTranslation(text, lang) {
  return `[${lang}] ${text}`;
}

function isRTLLanguage(languageCode, text = '') {
  const rtlLanguages = ['ar', 'he', 'fa', 'ur'];
  const hasRTLScript = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/.test(text);
  return rtlLanguages.includes(languageCode.toLowerCase()) || hasRTLScript;
}

function isNonLatinLanguage(languageCode) {
  const nonLatinLanguages = ['ar', 'zh', 'ja', 'ko', 'hi', 'ru', 'he', 'fa', 'ur', 'th'];
  return nonLatinLanguages.includes(languageCode.toLowerCase());
}

async function handleRTLProperties(node, targetLang, text) {
  if (isRTLLanguage(targetLang, text)) {
    if (node.textAutoResize === "FIXED") {
      node.textAutoResize = "WIDTH_AND_HEIGHT";
    }
    node.textAlignHorizontal = "RIGHT";
    
    if ('textDirection' in node) {
      node.textDirection = "RTL";
    }
    if ('paragraphDirectionType' in node) {
      node.paragraphDirectionType = "RTL";
    }
    
    node.paragraphSpacing = Math.max(node.paragraphSpacing, 1.5 * node.fontSize);
    
    if (targetLang.toLowerCase() === 'ar') {
      node.letterSpacing = { value: 0, unit: 'PIXELS' };
    }
  }
}

async function loadNonLatinFonts(node, lang) {
  const supportedFonts = {
    ar: [
      { family: "Noto Naskh Arabic", style: "Regular" },
      { family: "Noto Kufi Arabic", style: "Regular" },
      { family: "Dubai", style: "Regular" },
      { family: "Almarai", style: "Regular" },
      { family: "Cairo", style: "Regular" },
      { family: "IBM Plex Sans Arabic", style: "Regular" }
    ],
    zh: [
      { family: "Noto Sans SC", style: "Regular" },
      { family: "Source Han Sans CN", style: "Regular" },
      { family: "Microsoft YaHei", style: "Regular" }
    ],
    ja: [
      { family: "Noto Sans JP", style: "Regular" },
      { family: "Hiragino Sans", style: "W3" },
      { family: "Meiryo", style: "Regular" }
    ],
    ko: [
      { family: "Noto Sans KR", style: "Regular" },
      { family: "Malgun Gothic", style: "Regular" }
    ],
    hi: [
      { family: "Noto Sans Devanagari", style: "Regular" },
      { family: "Kohinoor Devanagari", style: "Regular" },
      { family: "Mangal", style: "Regular" },
      { family: "Aparajita", style: "Regular" }
    ],
    ru: [
      { family: "Noto Sans", style: "Regular" },
      { family: "Roboto", style: "Regular" },
      { family: "Arial", style: "Regular" }
    ]
  };
  
  // Add fallback fonts for all languages
  const fallbackFonts = [
    { family: "Arial", style: "Regular" },
    { family: "Segoe UI", style: "Regular" }
  ];
  
  // Get the appropriate fonts list for the language
  const fontList = supportedFonts[lang] || [];
  
  // Add fallbacks to the end of the list
  const allFonts = [...fontList, ...fallbackFonts];

  for (const font of allFonts) {
    try {
      await figma.loadFontAsync(font);
      node.fontName = font;
      return true;
    } catch (error) {
      console.warn(`Failed to load font ${font.family} for language ${lang}`);
      continue;
    }
  }
  
  // Final fallback to Inter
  await figma.loadFontAsync({ family: "Inter", style: "Regular" });
  node.fontName = { family: "Inter", style: "Regular" };
  return false;
}

function handleMixedContent(text, targetLang) {
  const patterns = {
    numbers: /[0-9]+/g,
    latin: /[A-Za-z]+/g,
    punctuation: /[.,!?;:'"(){}\[\]]/g,
    rtl: /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]+/g
  };

  const specialChars = {
    '(': ')',
    ')': '(',
    '[': ']',
    ']': '[',
    '{': '}',
    '}': '{'
  };

  return text.split(/(\s+)/).map(word => {
    if (patterns.numbers.test(word)) {
      return `\u202A${word}\u202C`;
    }
    if (patterns.latin.test(word)) {
      return `\u202A${word}\u202C`;
    }
    if (patterns.punctuation.test(word)) {
      return specialChars[word] || word;
    }
    return word;
  }).join('');
}

// New function to handle bullet lists specifically
function detectAndFormatBulletList(text) {
  // Check if text contains bullet points
  const hasBullets = text.includes('•') || /^\s*[-*]\s/.test(text);
  const lines = text.split('\n').filter(line => line.trim());
  
  return {
    isBulletList: hasBullets,
    items: lines.map(line => line.trim())
  };
}

// Force bullet list handler for language lists with improved RTL handling
async function translateLanguageList(node, targetLang) {
  try {
    // Extract the original language names
    const originalText = node.characters;
    const lines = originalText.split('\n').filter(line => line.trim());
    
    // Extract language names without bullets
    let langItems = lines.map(line => {
      // Remove bullet and trim
      return line.replace(/^[\s•\-\*]+/, '').trim();
    });

    if (langItems.length === 0) return false;
    
    // Check if this is likely a language list (contains language names)
    const commonLanguages = ['English', 'Japanese', 'Portuguese', 'German', 'French',
                           'Italian', 'Spanish', 'Russian', 'Chinese'];
    
    const isLanguageList = langItems.some(item => 
      commonLanguages.some(lang => item.includes(lang)));
    
    if (!isLanguageList) return false;
    
    // Handle translation differently - translate each language name individually
    const translatedLangs = [];
    const isRTL = isRTLLanguage(targetLang);
    // Use a single bullet character without extra space for RTL languages
    const bulletChar = isRTL ? '•' : '• ';
    
    for (const lang of langItems) {
      if (!lang.trim()) continue;
      
      try {
        const response = await fetch('http://localhost:3000/translate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: lang, targetLang })
        });
        
        const data = await response.json();
        // For RTL, place bullet after the text
        if (isRTL) {
          translatedLangs.push(`${data.translation} ${bulletChar}`);
        } else {
          translatedLangs.push(`${bulletChar}${data.translation}`);
        }
      } catch (error) {
        console.error('Failed to translate language:', lang, error);
        if (isRTL) {
          translatedLangs.push(`${lang} ${bulletChar}`);
        } else {
          translatedLangs.push(`${bulletChar}${lang}`);
        }
      }
    }
    
    // Apply the translated languages with proper formatting
    const formattedText = translatedLangs.join('\n');
    await figma.loadFontAsync(node.fontName);
    node.characters = formattedText;
    
    // Format as a bullet list with RTL considerations
    node.textAutoResize = "HEIGHT";
    node.paragraphSpacing = 12;
    node.paragraphIndent = isRTL ? 0 : 20; // No indent for RTL languages
    
    // Apply proper RTL settings if needed
    if (isRTL) {
      node.textAlignHorizontal = "RIGHT";
      if ('textDirection' in node) {
        node.textDirection = "RTL";
      }
      if ('paragraphDirectionType' in node) {
        node.paragraphDirectionType = "RTL";
      }
    }
    
    // Apply proper bullet list styling to each item
    let currentPosition = 0;
    for (const langText of translatedLangs) {
      if (node.setRangeListOptions && langText.trim()) {
        const itemLength = langText.length;
        try {
          node.setRangeListOptions(currentPosition, currentPosition + itemLength, {
            type: "UNORDERED",
            alignment: isRTL ? "RIGHT" : "LEFT",
            spacing: 12
          });
        } catch (e) {
          console.warn('Failed to set list options:', e);
        }
        currentPosition += itemLength + 1; // +1 for newline
      }
    }
    
    return true; // Successfully handled
  } catch (error) {
    console.error('Error in language list handler:', error);
    return false;
  }
}

// Enhanced simple translation function that preserves styles
async function simpleTranslateText(node, targetLang, forceRetranslate = false) {
  const originalText = node.characters;
  if (!originalText) return false;
  
  try {
    console.log(`[DEBUG] 🌍 Simple translate for node: "${originalText.substring(0, 30)}${originalText.length > 30 ? '...' : ''}"`);
    const translation = await translateText(originalText, targetLang, [], forceRetranslate);
    
    // Handle the new return format
    const translatedText = translation.translatedText || originalText;
    
    await applySimpleTranslation(node, translatedText);
    return true;
  } catch (error) {
    console.log(`[DEBUG] ❌ Simple translate error: ${error.message}`);
    return false;
  }
}

// Replace current translateNode function with this simplified version
async function translateNode(node, targetLang, totalNodes, filterSettings = {}, currentNode = { count: 0 }, forceRetranslate = false, preserveStyles = true) {
  // Skip filtering logic based on node type
  const skipInstances = filterSettings && filterSettings.skipInstances;
  
  try {
    // ========= HANDLE INSTANCES =========
    if (node.type === "INSTANCE" && !skipInstances) {
      try {
        console.log('Found instance, detaching:', node.name);
        // Detach in place - no cloning
        const detached = node.detachInstance();
        console.log('Instance detached successfully:', detached.name);
        
        // Process the detached node directly
        await translateNode(detached, targetLang, totalNodes, filterSettings, currentNode, forceRetranslate, preserveStyles);
        return;
      } catch (err) {
        console.error('Error detaching instance:', err);
      }
    }
    
    // ========= HANDLE TEXT =========
    if (node.type === "TEXT") {
      const originalText = node.characters.trim();
      
      console.log('TEXT NODE:', {
        id: node.id, 
        name: node.name,
        text: originalText,
        parent: (node.parent && node.parent.name) ? node.parent.name : 'none',
        forceRetranslate: forceRetranslate,
        preserveStyles: preserveStyles
      });
      
      if (!originalText || shouldSkipNode(node, filterSettings)) {
        currentNode.count++;
        return;
      }
      
      console.log(`Processing text: "${originalText}"`);
      
      // ========= TRANSLATE TEXT =========
      try {
        console.log('[NETWORK] 🌐 Starting translation request for:', originalText);
        console.log('[NETWORK] 🌐 Target language:', targetLang);
        console.log('[NETWORK] 🌐 Force retranslate:', forceRetranslate);
        
        // Collect style ranges if we're preserving styles
        let styleRanges = [];
        if (preserveStyles) {
          // Use Claude-based styling if enabled globally
          if (useClaudeStylingForTranslations) {
            console.log('[NETWORK] 🎨 Using Claude for style preservation');
            // Find style ranges to send with translation request
            styleRanges = await findStyleRanges(node, originalText);
          }
        }
        
        // Get translated text with or without style information
        const translationResult = await translateText(originalText, targetLang, styleRanges, forceRetranslate);
        
        if (!translationResult || !translationResult.translatedText) {
          throw new Error('Translation failed: no text returned');
        }
        
        const translatedText = translationResult.translatedText;
        const styleMapping = translationResult.styleMapping;
        
        console.log(`Translation result: "${translatedText}"`);
        
        // Apply the translated text to node with style preservation if enabled
        if (preserveStyles) {
          console.log('Applying translation with style preservation');
          await preserveTextStyles(node, originalText, translatedText, targetLang, styleMapping);
        } else {
          console.log('Applying translation without style preservation');
          await figma.loadFontAsync(node.fontName);
          node.characters = translatedText;
        }
        
        // Handle RTL languages
        const isRTL = isRTLLanguage(targetLang, translatedText);
        if (isRTL) {
          console.log('Applying RTL text properties');
          await handleRTLProperties(node, targetLang, translatedText);
        }
        
        // Update progress
        currentNode.count++;
        if (totalNodes > 0) {
          const progress = Math.round((currentNode.count / totalNodes) * 100);
          figma.ui.postMessage({ 
            type: 'translationProgress', 
            progress,
            originalText: originalText.substring(0, 30) + (originalText.length > 30 ? '...' : ''),
            translatedText: translatedText.substring(0, 30) + (translatedText.length > 30 ? '...' : '')
          });
        }
      } catch (error) {
        console.error('Translation or style application error:', error);
        try {
          // Fallback to simpler translation without style preservation
          console.log('Using fallback translation method');
          await figma.loadFontAsync(node.fontName);
          node.characters = originalText; // Ensure we have something
        } catch (fallbackError) {
          console.error('Even fallback failed:', fallbackError);
        }
      }
      
      // 3. After applying translation, add direct verification
      console.log('TRANSLATION APPLIED:', {
        original: originalText,
        translated: node.characters // This should match the translation
      });
      
      // 4. Check for special cases like language lists
      const isLanguageList = originalText.includes('\n') && 
        /^(English|Spanish|French|German|Italian|Portuguese|Japanese|Chinese|Korean|Arabic|Russian)/i.test(originalText);
      
      if (isLanguageList) {
        console.log('Detected language list, using special handler');
        await translateLanguageList(node, targetLang);
      }
    }
    
    // Process children
    if (node.children) {
      for (const child of node.children) {
        await translateNode(child, targetLang, totalNodes, filterSettings, currentNode, forceRetranslate, preserveStyles);
      }
    }
  } catch (error) {
    console.error('Error in translateNode:', error);
  }
}

// New style preservation function that ensures proper style mapping
async function applyTranslationWithStyle(node, originalStyle, translatedText) {
  console.log('Applying translated text with preserved styles:', translatedText);
  
  try {
    // Load the font
    try {
      await figma.loadFontAsync(originalStyle.fontName);
    } catch (e) {
      console.log('Error loading font, using fallback');
      await figma.loadFontAsync({ family: "Inter", style: "Regular" });
    }
    
    // Set the basic text
    node.characters = translatedText;
    
    // Apply node-level styles
    node.fontSize = originalStyle.fontSize;
    node.fills = originalStyle.fills;
    node.textCase = originalStyle.textCase;
    node.textDecoration = originalStyle.textDecoration;
    node.letterSpacing = originalStyle.letterSpacing;
    node.lineHeight = originalStyle.lineHeight;
    node.paragraphSpacing = originalStyle.paragraphSpacing;
    node.textAlignHorizontal = originalStyle.textAlignHorizontal;
    node.textAlignVertical = originalStyle.textAlignVertical;
    
    // Apply character-specific styles using weighted distribution
    const originalText = originalStyle.characters;
    
    // Only apply character styles if we have formatted text (different styles)
    let hasFormattedText = false;
    
    // Check if we have mixed styles
    let firstFill = null;
    if (originalStyle.charStyles && originalStyle.charStyles.length > 0) {
      firstFill = originalStyle.charStyles[0] && originalStyle.charStyles[0].fills;
    }
    
    if (firstFill && originalStyle.charStyles) {
      for (const style of originalStyle.charStyles) {
        if (style.fills && JSON.stringify(style.fills) !== JSON.stringify(firstFill)) {
          hasFormattedText = true;
          break;
        }
      }
    }
    
    // If we have formatted text, apply the styling
    if (hasFormattedText && originalStyle.charStyles && originalStyle.charStyles.length > 0) {
      // Get all words and their styles from original text
      const originalWords = originalText.match(/\S+/g) || [];
      const translatedWords = translatedText.match(/\S+/g) || [];
      
      if (originalWords.length > 0 && translatedWords.length > 0) {
        let translatedIndex = 0;
        
        for (let i = 0; i < Math.min(originalWords.length, translatedWords.length); i++) {
          // Find this word in the translated text
          const word = translatedWords[i];
          const wordIndex = translatedText.indexOf(word, translatedIndex);
          
          if (wordIndex >= 0) {
            // Get the style from the corresponding original word
            const origWordIndex = originalText.indexOf(originalWords[i]);
            if (origWordIndex >= 0 && origWordIndex < originalStyle.charStyles.length) {
              const style = originalStyle.charStyles[origWordIndex];
              
              // Load the font for this word
              try {
                if (style.fontName) {
                  await figma.loadFontAsync(style.fontName);
                }
                
                // Apply styles to this word
                const wordEnd = wordIndex + word.length;
                node.setRangeFills(wordIndex, wordEnd, style.fills);
                node.setRangeFontName(wordIndex, wordEnd, style.fontName);
                node.setRangeFontSize(wordIndex, wordEnd, style.fontSize);
                node.setRangeTextDecoration(wordIndex, wordEnd, style.textDecoration);
              } catch (e) {
                console.warn('Error applying word style:', e);
              }
            }
            
            // Move past this word
            translatedIndex = wordIndex + word.length;
          }
        }
      }
    }
    
    // Add to the top of the function
    console.log('Style info:', {
      hasCharStyles: !!originalStyle.charStyles,
      charStylesLength: originalStyle.charStyles ? originalStyle.charStyles.length : 0,
      firstCharStyle: originalStyle.charStyles && originalStyle.charStyles.length > 0 ? 
        originalStyle.charStyles[0] : null
    });
    
    return true;
  } catch (error) {
    console.error('Error applying translation with style:', error);
    return false;
  }
}

// Helper function to find corresponding text node after detaching
function findCorrespondingTextNode(detachedRoot, originalTextNode) {
  // This is a simplistic approach - you might need to make it more robust
  const allTextNodes = [];
  
  function collectTextNodes(node) {
    if (node.type === "TEXT") {
      allTextNodes.push(node);
    }
    
    if (node.children) {
      node.children.forEach(collectTextNodes);
    }
  }
  
  collectTextNodes(detachedRoot);
  
  // Find node with same text content and position
  return allTextNodes.find(node => 
    node.characters === originalTextNode.characters &&
    Math.abs(node.x - originalTextNode.x) < 1 &&
    Math.abs(node.y - originalTextNode.y) < 1
  );
}

// Helper to check if a node is within an instance
function isWithinInstance(node) {
  let parent = node.parent;
  while (parent) {
    if (parent.type === "INSTANCE") {
      return true;
    }
    parent = parent.parent;
  }
  return false;
}

// Helper to get the root instance of a node
function getRootInstance(node) {
  let current = node;
  let parent = node.parent;
  while (parent) {
    if (parent.type === "INSTANCE" && parent.parent.type !== "INSTANCE") {
      return parent;
    }
    current = parent;
    parent = parent.parent;
  }
  return null;
}

// Helper to safely detach an instance
async function safeDetachInstance(instance) {
  try {
    console.log('Attempting to detach instance:', instance.name);
    const detached = instance.detachInstance();
    console.log('Instance detached successfully');
    return detached;
  } catch (error) {
    console.warn('Failed to detach instance:', error);
    return null;
  }
}

// Helper function to determine if a node should be skipped based on filter settings
function shouldSkipNode(node, filterSettings) {
  const text = node.characters.trim();
  
  // Skip very short text
  if (text.length <= 1) return true;
  
  if (!filterSettings) return false;
  
  // UI elements filter
  if (filterSettings.skipUiElements && 
      /^(button|menu|close|back|next|done|cancel|submit|ok|yes|no)$/i.test(text)) {
    return true;
  }
  
  // URLs and emails filter
  if (filterSettings.skipURLsEmails && 
      /^(http|www\.|mailto:|[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})/.test(text)) {
    return true;
  }
  
  // Dates and timestamps filter
  if (filterSettings.skipDates && 
      /^\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4}|\d{1,2}:\d{2}/.test(text)) {
    return true;
  }
  
  // Placeholder filter
  if (filterSettings.skipPlaceholders && 
      /(placeholder|lorem ipsum|dummy)/i.test(text)) {
    return true;
  }
  
  // Component instances filter
  if (filterSettings.skipInstances && 
      (node.parent && (node.parent.type === "COMPONENT" || node.parent.type === "INSTANCE"))) {
    return true;
  }
  
  return false;
}

// Generic list formatting function
async function applyListFormatting(node, translatedText, originalStyles) {
  try {
    const lines = translatedText.split('\n').filter(line => line.trim());
    
    if (lines.length > 0) {
      const cleanedLines = lines.map(line => cleanBulletText(line));
      const formattedText = cleanedLines.map(line => 
        line ? `• ${line}` : line
      ).join('\n');

      // Set the text
      node.characters = formattedText;

      // Apply original styles including colors
      if (originalStyles) {
        // Find first word of translated text
        const translatedWords = formattedText.split(/\s+/);
        const firstTranslatedWordLength = translatedWords[0].length;

        // Apply first word style
        if (originalStyles.rangeFills[0]) {
          try {
            node.setRangeFills(0, firstTranslatedWordLength, originalStyles.rangeFills[0].fills);
          } catch (e) {
            console.warn('Failed to set first word fills:', e);
          }
        }

        // Apply rest of text style
        if (originalStyles.rangeFills[1]) {
          try {
            node.setRangeFills(
              firstTranslatedWordLength, 
              formattedText.length,
              originalStyles.rangeFills[1].fills
            );
          } catch (e) {
            console.warn('Failed to set remaining text fills:', e);
          }
        }
      }

      // Apply formatting
      node.textAutoResize = "HEIGHT";
      node.paragraphSpacing = 12;
      node.paragraphIndent = 20;

      // Apply list properties
      let currentPosition = 0;
      cleanedLines.forEach((line) => {
        if (!line) return;
        const itemLength = line.length + 2;
        
        if (node.setRangeListOptions) {
          try {
            node.setRangeListOptions(currentPosition, currentPosition + itemLength, {
              type: "UNORDERED"
            });
          } catch (e) {
            console.warn('Failed to set list options:', e);
          }
        }
        currentPosition += itemLength + 1;
      });
    }
  } catch (error) {
    console.error('Error formatting list:', error);
  }
}

function cleanBulletText(text) {
  // Remove ALL bullet points and extra spaces, including translated ones
  return text
    .replace(/^[•⁃⁌⁍∙◦≡→⟐◆◇⬧⦿⦾■□☐☑✓✔✕✗✘☓☒⊗⊠]\s*/g, '') // Unicode bullets
    .replace(/^[-*+]\s*/g, '')  // ASCII bullets
    .replace(/^\s*[•]\s*/g, '') // Specific bullet point
    .trim();
}

// Count total text nodes
function countTextNodes(node) {
  try {
    let count = 0;
    if (node && node.type === "TEXT") {
      if (node.characters && node.characters.trim().length > 0) {
        count++;
        console.log('Found text node:', node.characters.substring(0, 30) + '...');
        figma.ui.postMessage({
          type: 'debugInfo',
          message: `Found text node: ${node.characters.substring(0, 30)}...`
        });
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
  try {
    const selection = figma.currentPage.selection;
    if (selection && selection.length === 1 && selection[0].type === "FRAME") {
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
  } catch (error) {
    console.error('Error during selection change:', error);
  }
});

// At the top of code.js, add debug flag
const DEBUG = true;

// Message handler with better debugging
figma.ui.onmessage = async (msg) => {
  if (msg.type === 'translateFrame') {
    try {
      figma.ui.postMessage({ 
        type: 'translationStarted',
        message: 'Translation in progress...'
      });

      const selection = figma.currentPage.selection;
      if (selection.length === 0) {
        figma.notify('Please select a frame to translate');
        figma.ui.postMessage({ type: 'translationComplete' });
        return;
      }

      const sourceFrame = selection[0];
      const clonedFrame = sourceFrame.clone();
      clonedFrame.x = sourceFrame.x + sourceFrame.width + 100;
      clonedFrame.name = `${sourceFrame.name} - ${msg.language}`;

      // Add notification for instance handling
      let hasInstances = false;
      let textNodeCount = 0;
      
      const checkForInstances = (node) => {
        if (node.type === "INSTANCE") {
          hasInstances = true;
        }
        if (node.type === "TEXT") {
          textNodeCount++;
        }
        if (node.children) {
          node.children.forEach(checkForInstances);
        }
      };
      checkForInstances(clonedFrame);
      
      // Send node count back to UI for progress tracking
      figma.ui.postMessage({ 
        type: 'textNodeCount', 
        count: textNodeCount 
      });

      if (hasInstances) {
        figma.notify('Processing component instances... This may take a moment.');
      }

      // Get style preservation settings
      const preserveStyles = msg.preserveStyles !== undefined ? msg.preserveStyles : true;
      const useClaudeStyling = msg.useClaudeStyling !== undefined ? msg.useClaudeStyling : true;
      
      console.log(`[DEBUG] 🎨 Style settings - Preserve: ${preserveStyles}, Use Claude: ${useClaudeStyling}`);
      
      // Initialize global flag for Claude-based styling
      useClaudeStylingForTranslations = useClaudeStyling;
      
      await safeTranslateNode(
        clonedFrame, 
        msg.languageCode, 
        textNodeCount, 
        msg.filterSettings, 
        null, 
        msg.forceRetranslate,
        preserveStyles
      );

      figma.currentPage.selection = [clonedFrame];
      figma.viewport.scrollAndZoomIntoView([clonedFrame]);

      figma.ui.postMessage({ 
        type: 'translationComplete',
        message: 'Translation completed!'
      });
    } catch (error) {
      console.error('Translation error:', error);
      figma.ui.postMessage({ 
        type: 'error',
        message: `Translation error: ${error.message}`
      });
    }
  } else if (msg.type === 'checkInitialSelection') {
    // Check if there's a frame selected when the plugin starts
    try {
      const selection = figma.currentPage.selection;
      if (selection.length === 1 && selection[0].type === "FRAME") {
        figma.ui.postMessage({ 
          type: 'frameSelected',
          name: selection[0].name
        });
      } else {
        figma.ui.postMessage({ type: 'noFrameSelected' });
      }
    } catch (error) {
      console.error('Error checking initial selection:', error);
      figma.ui.postMessage({ type: 'noFrameSelected' });
    }
  } else if (msg.type === 'clearCache') {
    // Handle cache clearing
    try {
      clearTranslationCache(msg.language);
      figma.ui.postMessage({ 
        type: 'cacheCleared',
        language: msg.language
      });
      figma.notify(`Translation cache ${msg.language ? 'for ' + msg.language : ''} cleared`);
    } catch (error) {
      console.error('Error clearing cache:', error);
      figma.ui.postMessage({ 
        type: 'error',
        message: `Error clearing cache: ${error.message}`
      });
    }
  }
};
// Add server check on plugin start
checkServerConnectivity().then(isConnected => {
  if (isConnected) {
    console.log('[SERVER] ✅ Server is connected');
    figma.notify('Translation server connected');
    figma.ui.postMessage({ 
      type: 'serverStatus', 
      status: 'connected',
      message: 'Translation server is connected and ready'
    });
  } else {
    console.log('[SERVER] ❌ Server is not connected');
    figma.notify('Translation server not connected. Please make sure the server is running at http://localhost:3000', { error: true });
    figma.ui.postMessage({ 
      type: 'serverStatus', 
      status: 'disconnected',
      message: 'Translation server is not running. Please start the proxy server first.'
    });
  }
});

// Initial selection check
try {
  const initialSelection = figma.currentPage.selection;
  if (initialSelection && initialSelection.length === 1 && initialSelection[0].type === "FRAME") {
    sourceFrame = initialSelection[0];
    figma.ui.postMessage({ 
      type: 'frameSelected',
      name: sourceFrame.name
    });
  }
} catch (error) {
  console.error('Error during initial selection check:', error);
}

// New function to capture all text properties
function captureTextProperties(node) {
  const properties = {
    // Text styles
    fontName: node.fontName,
    fontSize: node.fontSize,
    fontWeight: node.fontWeight,
    textCase: node.textCase,
    textDecoration: node.textDecoration,
    letterSpacing: node.letterSpacing,
    lineHeight: node.lineHeight,
    
    // Paragraph styles
    paragraphIndent: node.paragraphIndent,
    paragraphSpacing: node.paragraphSpacing,
    
    // List properties
    listSpacing: node.listSpacing,
    
    // Text alignment
    textAlignHorizontal: node.textAlignHorizontal,
    textAlignVertical: node.textAlignVertical,
    
    // RTL properties
    textDirection: node.textDirection,
  };

  // Safely capture bullet type
  try {
    if (typeof node.getRangeBullets === 'function') {
      properties.bulletType = node.getRangeBullets(0, 1);
    }
  } catch (error) {
    console.warn('Bullet capture failed:', error);
  }

  // Capture style ranges safely
  try {
    properties.styleRanges = [];
    const length = node.characters.length;
    
    let currentRange = {
      start: 0,
      end: 1,
      fontName: node.getRangeFontName(0, 1),
      fontSize: node.getRangeFontSize(0, 1),
      fills: node.getRangeFills(0, 1),
      textCase: node.getRangeTextCase(0, 1),
      textDecoration: node.getRangeTextDecoration(0, 1),
      letterSpacing: node.getRangeLetterSpacing(0, 1),
      lineHeight: node.getRangeLineHeight(0, 1)
    };

    // Safely add hyperlink if available
    if (typeof node.getRangeHyperlink === 'function') {
      try {
        currentRange.hyperlink = node.getRangeHyperlink(0, 1);
      } catch (e) {
        console.warn('Hyperlink capture failed:', e);
      }
    }

    // Safely add list options if available
    if (typeof node.getRangeListOptions === 'function') {
      try {
        currentRange.listOptions = node.getRangeListOptions(0, 1);
      } catch (e) {
        console.warn('List options capture failed:', e);
      }
    }

    for (let i = 1; i < length; i++) {
      const nextStyle = {
        fontName: node.getRangeFontName(i, i + 1),
        fontSize: node.getRangeFontSize(i, i + 1),
        fills: node.getRangeFills(i, i + 1),
        textCase: node.getRangeTextCase(i, i + 1),
        textDecoration: node.getRangeTextDecoration(i, i + 1),
        letterSpacing: node.getRangeLetterSpacing(i, i + 1),
        lineHeight: node.getRangeLineHeight(i, i + 1)
      };

      const hasSameStyles = Object.keys(nextStyle).every(key => 
        JSON.stringify(nextStyle[key]) === JSON.stringify(currentRange[key])
      );

      if (hasSameStyles) {
        currentRange.end = i + 1;
      } else {
        properties.styleRanges.push(Object.assign({}, currentRange));
        currentRange = Object.assign({
          start: i,
          end: i + 1
        }, nextStyle);
      }
    }

    properties.styleRanges.push(Object.assign({}, currentRange));
  } catch (error) {
    console.warn('Style range capture failed:', error);
    properties.styleRanges = [];
  }

  return properties;
}

// New function to apply preserved properties
async function applyTextProperties(node, properties, isRTL = false) {
  try {
    // First, check if this is a heading (larger font size)
    const isHeading = node.fontSize > 20; // Adjust threshold as needed
    
    // Load fonts first
    await figma.loadFontAsync(node.fontName);
    
    // Special handling for headings
    if (isHeading) {
      // Preserve original width
      const originalWidth = node.width;
      
      // Apply text first
      node.textAutoResize = "HEIGHT";
      node.width = originalWidth;
      
      // Ensure heading stays on top
      node.y = properties.y || node.y; // Preserve vertical position
    }

    // Apply base properties safely
    const baseProps = [
      'fontSize', 'textCase', 'textDecoration', 'letterSpacing',
      'lineHeight', 'paragraphIndent', 'paragraphSpacing', 'textAlignVertical'
    ];

    baseProps.forEach(prop => {
      try {
        if (prop in properties && properties[prop] !== undefined) {
          node[prop] = properties[prop];
        }
      } catch (error) {
        console.warn(`Failed to apply property ${prop}:`, error);
      }
    });

    // Handle RTL specific properties
    try {
      if (isRTL) {
        node.textAlignHorizontal = "RIGHT";
        if ('textDirection' in node) {
          node.textDirection = "RTL";
        }
      } else {
        node.textAlignHorizontal = properties.textAlignHorizontal;
      }
    } catch (error) {
      console.warn('RTL property application failed:', error);
    }

    // Apply list properties if they exist
    try {
      if (properties.listSpacing !== undefined) {
        node.listSpacing = properties.listSpacing;
      }
    } catch (error) {
      console.warn('List spacing application failed:', error);
    }

    // Apply style ranges
    if (properties.styleRanges && properties.styleRanges.length > 0) {
      for (const range of properties.styleRanges) {
        try {
          const length = node.characters.length;
          const start = Math.min(range.start, length);
          const end = Math.min(range.end, length);

          if (start < end) {
            // Load range font
            if (range.fontName) {
              try {
                await figma.loadFontAsync(range.fontName);
                node.setRangeFontName(start, end, range.fontName);
              } catch (error) {
                console.warn('Range font loading failed:', error);
                await figma.loadFontAsync({ family: "Inter", style: "Regular" });
                node.setRangeFontName(start, end, { family: "Inter", style: "Regular" });
              }
            }

            // Apply other range properties safely
            if (range.fontSize) node.setRangeFontSize(start, end, range.fontSize);
            if (range.fills) node.setRangeFills(start, end, range.fills);
            if (range.textCase) node.setRangeTextCase(start, end, range.textCase);
            if (range.textDecoration) node.setRangeTextDecoration(start, end, range.textDecoration);
            if (range.letterSpacing) node.setRangeLetterSpacing(start, end, range.letterSpacing);
            if (range.lineHeight) node.setRangeLineHeight(start, end, range.lineHeight);
          }
        } catch (error) {
          console.warn('Style range application failed:', error);
        }
      }
    }

    const spacingInfo = preserveSpacing(node, properties);
    node.y = spacingInfo.originalY;
    if (spacingInfo.spacingFromPrevious) {
      const parent = node.parent;
      if (parent && parent.children) {
        const nodeIndex = parent.children.indexOf(node);
        if (nodeIndex > 0) {
          const previousNode = parent.children[nodeIndex - 1];
          node.y = previousNode.y + previousNode.height + spacingInfo.spacingFromPrevious;
        }
      }
    }

    return true;
  } catch (error) {
    console.error('Error applying text properties:', error);
    return false;
  }
}

// Track relative positioning for layout adjustment
function captureRelativePositioning(node) {
  if (!node.parent || !node.parent.children) {
    return null;
  }
  
  const siblings = node.parent.children;
  const nodeIndex = siblings.indexOf(node);
  
  // Get previous and next siblings if they exist
  const prevSibling = nodeIndex > 0 ? siblings[nodeIndex - 1] : null;
  const nextSibling = nodeIndex < siblings.length - 1 ? siblings[nodeIndex + 1] : null;
  
  // Calculate spacing relationships
  const relationships = {
    // Position relative to parent
    parentTop: node.y,
    parentLeft: node.x,
    
    // Spacing between elements
    spacingBefore: prevSibling ? (node.y - (prevSibling.y + prevSibling.height)) : null,
    spacingAfter: nextSibling ? (nextSibling.y - (node.y + node.height)) : null,
    
    // Original dimensions
    originalWidth: node.width,
    originalHeight: node.height,
    
    // Auto resize settings
    autoResize: node.textAutoResize
  };
  
  return relationships;
}

// Adjust layout after translation to maintain spacing
function adjustLayoutAfterTranslation(originalNode, translatedNode, relationships, targetLang) {
  if (!relationships || !originalNode.parent || !originalNode.parent.children) {
    return;
  }
  
  const siblings = originalNode.parent.children;
  const nodeIndex = siblings.indexOf(translatedNode);
  
  // Skip if node not found in parent
  if (nodeIndex === -1) return;
  
  // Calculate how much the height changed
  const heightDifference = translatedNode.height - relationships.originalHeight;
  
  // Only adjust if there was a change in height
  if (heightDifference !== 0) {
    // Adjust positions of elements below this one
    for (let i = nodeIndex + 1; i < siblings.length; i++) {
      const sibling = siblings[i];
      
      // Only adjust elements that are below (not beside)
      if (sibling.x < translatedNode.x + translatedNode.width &&
          sibling.x + sibling.width > translatedNode.x) {
        sibling.y += heightDifference;
      }
    }
  }
  
  // Handle width changes for RTL languages
  if (isRTLLanguage(targetLang) && translatedNode.textAutoResize !== "WIDTH_AND_HEIGHT") {
    // For RTL languages, maintain right alignment
    const widthDifference = translatedNode.width - relationships.originalWidth;
    if (widthDifference !== 0) {
      translatedNode.x -= widthDifference;
    }
  }
}

function preserveSpacing(node, properties) {
  // Store original spacing
  const originalY = node.y;
  const originalSpacing = properties.paragraphSpacing;
  
  // Safe navigation without optional chaining
  const parent = node.parent;
  if (parent && parent.children) {
    const nodeIndex = parent.children.indexOf(node);
    if (nodeIndex > 0) {
      const previousNode = parent.children[nodeIndex - 1];
      const spacingFromPrevious = node.y - (previousNode.y + previousNode.height);
      return {
        spacingFromPrevious,
        originalY
      };
    }
  }
  
  return { originalY };
}

function captureListProperties(node) {
  const listProps = {
    isList: node.getRangeListOptions && node.getRangeListOptions(0, 1),
    bulletSpacing: node.listSpacing,
    indentation: node.paragraphIndent,
    bulletType: node.getRangeBullets && node.getRangeBullets(0, 1)
  };

  // Capture individual bullet points
  const text = node.characters;
  const lines = text.split('\n');
  listProps.items = lines.map((line, index) => ({
    text: line,
    bulletProps: node.getRangeListOptions && node.getRangeListOptions(
      text.indexOf(line),
      text.indexOf(line) + line.length
    )
  }));

  return listProps;
}

async function applyListProperties(node, listProps, translatedText) {
  if (!listProps.isList) return;

  // Split translated text into lines
  const translatedLines = translatedText.split('\n');

  // Apply bullet properties line by line
  let currentIndex = 0;
  for (let i = 0; i < translatedLines.length; i++) {
    const line = translatedLines[i];
    if (!line.trim()) continue;

    const end = currentIndex + line.length;
    
    // Apply bullet point properties - Fixed optional chaining
    if (node.setRangeListOptions) {
      try {
        let bulletProps = listProps.isList;
        if (listProps.items && listProps.items[i] && listProps.items[i].bulletProps) {
          bulletProps = listProps.items[i].bulletProps;
        }
        node.setRangeListOptions(currentIndex, end, bulletProps);
      } catch (e) {
        console.warn('Failed to apply bullet properties:', e);
      }
    }

    currentIndex = end + 1; // +1 for newline
  }

  // Restore list spacing and indentation
  node.listSpacing = listProps.bulletSpacing;
  node.paragraphIndent = listProps.indentation;
}

function captureTextStyles(node) {
  const ranges = [];
  let currentIndex = 0;
  const text = node.characters;
  
  while (currentIndex < text.length) {
    // Capture all style properties for this range
    const styleProps = {
      fills: node.getRangeFills(currentIndex, currentIndex + 1),
      fontName: node.getRangeFontName(currentIndex, currentIndex + 1),
      fontSize: node.getRangeFontSize(currentIndex, currentIndex + 1),
      textCase: node.getRangeTextCase(currentIndex, currentIndex + 1),
      textDecoration: node.getRangeTextDecoration(currentIndex, currentIndex + 1),
      letterSpacing: node.getRangeLetterSpacing(currentIndex, currentIndex + 1),
      lineHeight: node.getRangeLineHeight(currentIndex, currentIndex + 1)
    };
    
    let rangeEnd = currentIndex + 1;
    
    // Find how far these styles extend
    while (rangeEnd < text.length) {
      if (!doStylesMatch(
        node, 
        styleProps,
        rangeEnd,
        rangeEnd + 1
      )) {
        break;
      }
      rangeEnd++;
    }
    
    ranges.push({
      start: currentIndex,
      end: rangeEnd,
      styles: styleProps,
      text: text.substring(currentIndex, rangeEnd)
    });
    
    currentIndex = rangeEnd;
  }
  
  return ranges;
}

// Add this helper function to compare styles
function doStylesMatch(node, baseStyles, start, end) {
  const properties = [
    'fills',
    'fontName',
    'fontSize',
    'textCase',
    'textDecoration',
    'letterSpacing',
    'lineHeight'
  ];
  
  for (const prop of properties) {
    const getRangeProp = `getRange${prop.charAt(0).toUpperCase() + prop.slice(1)}`;
    const currentStyle = node[getRangeProp](start, end);
    if (JSON.stringify(currentStyle) !== JSON.stringify(baseStyles[prop])) {
      return false;
    }
  }
  
  return true;
}

async function applyPreservedStyles(node, originalStyles, translatedText) {
  // First apply the text
  node.characters = translatedText;
  
  // Calculate relative positions in translated text
  const originalLength = originalStyles.reduce((sum, range) => 
    sum + (range.end - range.start), 0);
  
  let currentPos = 0;
  for (const range of originalStyles) {
    const rangeLength = range.end - range.start;
    const proportion = rangeLength / originalLength;
    const newRangeLength = Math.round(translatedText.length * proportion);
    
    try {
      // Apply each style property
      for (const [prop, value] of Object.entries(range.styles)) {
        const setRangeProp = `setRange${prop.charAt(0).toUpperCase() + prop.slice(1)}`;
        if (node[setRangeProp]) {
          await node[setRangeProp](
            currentPos,
            currentPos + newRangeLength,
            value
          );
        }
      }
    } catch (e) {
      console.warn('Failed to apply style range:', e);
    }
    
    currentPos += newRangeLength;
  }
  
  // Handle any remaining text (rounding errors)
  if (currentPos < translatedText.length) {
    const lastStyle = originalStyles[originalStyles.length - 1].styles;
    try {
      for (const [prop, value] of Object.entries(lastStyle)) {
        const setRangeProp = `setRange${prop.charAt(0).toUpperCase() + prop.slice(1)}`;
        if (node[setRangeProp]) {
          await node[setRangeProp](
            currentPos,
            translatedText.length,
            value
          );
        }
      }
    } catch (e) {
      console.warn('Failed to apply style to remaining text:', e);
    }
  }
}

// Add this new helper function to handle component instances
async function handleComponentInstance(instance, targetLang, totalNodes, filterSettings, currentNode) {
  try {
    console.log('Processing instance:', instance.name);
    
    // If instance is locked, detach it
    if (instance.locked) {
      console.log('Instance is locked, detaching...');
      instance = instance.detachInstance();
    }

    // Process all text nodes in the instance
    if (instance.children) {
      for (const child of instance.children) {
        if (child.type === "TEXT") {
          console.log('Found text node in instance:', child.characters);
          await translateNode(child, targetLang, totalNodes, filterSettings, currentNode);
        } else if (child.type === "INSTANCE") {
          // Handle nested instances
          await handleComponentInstance(child, targetLang, totalNodes, filterSettings, currentNode);
        } else if (child.children) {
          // Process other container nodes
          for (const grandChild of child.children) {
            await translateNode(grandChild, targetLang, totalNodes, filterSettings, currentNode);
          }
        }
      }
    }
  } catch (error) {
    console.error('Error processing instance:', error);
  }
}

// Improved function to capture all text styles
function captureCompleteTextStyles(node) {
  const styles = {
    // Node-level properties
    fontName: node.fontName,
    fontSize: node.fontSize,
    fills: node.fills,
    textCase: node.textCase,
    textDecoration: node.textDecoration,
    letterSpacing: node.letterSpacing,
    lineHeight: node.lineHeight,
    
    // Capture character-by-character styling
    styleRanges: []
  };

  try {
    // Get text content for reference
    const text = node.characters;
    
    // Start with first character's style
    let currentRange = {
      start: 0,
      end: 1,
      fontName: node.getRangeFontName(0, 1),
      fontSize: node.getRangeFontSize(0, 1),
      fills: node.getRangeFills(0, 1),
      textCase: node.getRangeTextCase(0, 1),
      textDecoration: node.getRangeTextDecoration(0, 1),
      letterSpacing: node.getRangeLetterSpacing(0, 1),
      lineHeight: node.getRangeLineHeight(0, 1)
    };
    
    // Check for font weight (bold) and style (italic)
    if (currentRange.fontName) {
      currentRange.isBold = currentRange.fontName.style.toLowerCase().includes('bold');
      currentRange.isItalic = currentRange.fontName.style.toLowerCase().includes('italic');
    }

    // Process remaining characters
    for (let i = 1; i < text.length; i++) {
      // Get current character style
      const nextStyle = {
        fontName: node.getRangeFontName(i, i + 1),
        fontSize: node.getRangeFontSize(i, i + 1),
        fills: node.getRangeFills(i, i + 1),
        textCase: node.getRangeTextCase(i, i + 1),
        textDecoration: node.getRangeTextDecoration(i, i + 1),
        letterSpacing: node.getRangeLetterSpacing(i, i + 1),
        lineHeight: node.getRangeLineHeight(i, i + 1)
      };
      
      // Add bold/italic info
      if (nextStyle.fontName) {
        nextStyle.isBold = nextStyle.fontName.style.toLowerCase().includes('bold');
        nextStyle.isItalic = nextStyle.fontName.style.toLowerCase().includes('italic');
      }

      // Check if style changed
      const hasSameStyle = 
        JSON.stringify(currentRange.fontName) === JSON.stringify(nextStyle.fontName) &&
        currentRange.fontSize === nextStyle.fontSize &&
        JSON.stringify(currentRange.fills) === JSON.stringify(nextStyle.fills) &&
        currentRange.textCase === nextStyle.textCase &&
        currentRange.textDecoration === nextStyle.textDecoration;

      if (hasSameStyle) {
        // Extend current range
        currentRange.end = i + 1;
      } else {
        // Add current range to list and start new one
        styles.styleRanges.push(Object.assign({}, currentRange));
        currentRange = Object.assign({
          start: i,
          end: i + 1
        }, nextStyle);
      }
    }
    
    // Add final range
    styles.styleRanges.push(Object.assign({}, currentRange));
    
    // Map ranges to words for better translation mapping
    styles.wordRanges = mapStylesToWords(text, styles.styleRanges);
    
  } catch (error) {
    console.error('Error capturing text styles:', error);
  }

  return styles;
}

// Map style ranges to words for better translation mapping
function mapStylesToWords(text, styleRanges) {
  const words = text.split(/(\s+)/);
  const wordRanges = [];
  
  let currentPos = 0;
  words.forEach(word => {
    if (word.trim()) {
      const wordRange = {
        text: word,
        start: currentPos,
        end: currentPos + word.length,
        styles: []
      };
      
      // Find all styles that apply to this word
      styleRanges.forEach(style => {
        if (style.end > wordRange.start && style.start < wordRange.end) {
          wordRange.styles.push(style);
        }
      });
      
      wordRanges.push(wordRange);
    }
    currentPos += word.length;
  });
  
  return wordRanges;
}

// Apply styles to translated text
async function applyCompleteStyles(node, originalStyles, translatedText) {
  try {
    // First load the font
    await figma.loadFontAsync(originalStyles.fontName);
    
    // Set basic properties
    node.characters = translatedText;
    node.fontSize = originalStyles.fontSize;
    node.fills = originalStyles.fills;
    node.textCase = originalStyles.textCase;
    node.textDecoration = originalStyles.textDecoration;
    node.letterSpacing = originalStyles.letterSpacing;
    node.lineHeight = originalStyles.lineHeight;

    // Split translated text into words
    const translatedWords = translatedText.split(/(\s+)/).filter(w => w.trim());
    
    // If we have original word styling and translated words
    if (originalStyles.wordRanges && translatedWords.length > 0) {
      // Map styles from original words to translated words
      let currentPos = 0;
      
      // Apply style to each word based on position in sequence
      for (let i = 0; i < translatedWords.length; i++) {
        const word = translatedWords[i];
        // Get style from corresponding original word
        const originalWordIndex = Math.min(i, originalStyles.wordRanges.length - 1);
        const originalWordStyles = originalStyles.wordRanges[originalWordIndex].styles;
        
        // If we have style information
        if (originalWordStyles && originalWordStyles.length > 0) {
          // Get the dominant style
          const primaryStyle = originalWordStyles[0];
          
          const wordEnd = currentPos + word.length;
          
          // Apply all style properties
          try {
            // Handle font name and bold/italic
            if (primaryStyle.fontName) {
              await figma.loadFontAsync(primaryStyle.fontName);
              node.setRangeFontName(currentPos, wordEnd, primaryStyle.fontName);
            }
            
            // Apply other properties
            if (primaryStyle.fontSize) {
              node.setRangeFontSize(currentPos, wordEnd, primaryStyle.fontSize);
            }
            
            if (primaryStyle.fills) {
              node.setRangeFills(currentPos, wordEnd, primaryStyle.fills);
            }
            
            if (primaryStyle.textCase) {
              node.setRangeTextCase(currentPos, wordEnd, primaryStyle.textCase);
            }
            
            if (primaryStyle.textDecoration) {
              node.setRangeTextDecoration(currentPos, wordEnd, primaryStyle.textDecoration);
            }
          } catch (error) {
            console.warn('Error applying style to word:', word, error);
          }
        }
        
        currentPos += word.length + 1; // +1 for space
      }
    }
    
    return true;
  } catch (error) {
    console.error('Error applying complete styles:', error);
    return false;
  }
}

// Function to apply list formatting while preserving styles
async function applyListFormattingWithStyles(node, translatedText, originalStyles) {
  try {
    const lines = translatedText.split('\n').filter(line => line.trim());
    
    if (lines.length > 0) {
      // Clean and format each line
      const cleanedLines = lines.map(line => cleanBulletText(line));
      const formattedText = cleanedLines.map(line => 
        line ? `• ${line}` : line
      ).join('\n');

      // Apply complete styles first
      await applyCompleteStyles(node, originalStyles, formattedText);

      // Then apply list formatting
      node.textAutoResize = "HEIGHT";
      node.paragraphSpacing = 12;
      node.paragraphIndent = 20;

      // Format each line
      let currentPosition = 0;
      cleanedLines.forEach((line) => {
        if (!line) return;
        const itemLength = line.length + 2; // +2 for bullet and space
        
        if (node.setRangeListOptions) {
          try {
            node.setRangeListOptions(currentPosition, currentPosition + itemLength, {
              type: "UNORDERED"
            });
          } catch (e) {
            console.warn('Failed to set list options:', e);
          }
        }
        currentPosition += itemLength + 1; // +1 for newline
      });
    }
  } catch (error) {
    console.error('Error formatting list with styles:', error);
  }
}

// Add this simple function for style capture
function captureAllNodeStyles(node) {
  console.log('Capturing styles for:', node.characters);
  
  // Basic node styles
  const styles = {
    // Node properties
    fontName: node.fontName,
    fontSize: node.fontSize,
    fills: node.fills,
    textCase: node.textCase,
    textDecoration: node.textDecoration,
    letterSpacing: node.letterSpacing,
    lineHeight: node.lineHeight,
    paragraphSpacing: node.paragraphSpacing,
    paragraphIndent: node.paragraphIndent,
    textAlignHorizontal: node.textAlignHorizontal,
    textAlignVertical: node.textAlignVertical,
    
    // Character styles (with position)
    characterStyles: []
  };
  
  // Get character-by-character styling
  try {
    const text = node.characters;
    for (let i = 0; i < text.length; i++) {
      styles.characterStyles.push({
        position: i,
        fontName: node.getRangeFontName(i, i+1),
        fills: node.getRangeFills(i, i+1)
      });
    }
  } catch (e) {
    console.log('Error capturing character styles:', e);
  }
  
  console.log('Captured styles:', styles);
  return styles;
}

// Enhanced style capture function with better color handling
function captureCompleteNodeStyles(node) {
  console.log('[DEBUG] 🎨 Capturing complete styles for:', node.characters.substring(0, 30) + (node.characters.length > 30 ? '...' : ''));
  
  // Basic node styles
  const styles = {
    // Node properties
    fontName: node.fontName,
    fontSize: node.fontSize,
    fills: deepCloneWithColorNormalization(node.fills),
    textCase: node.textCase,
    textDecoration: node.textDecoration,
    letterSpacing: node.letterSpacing,
    lineHeight: node.lineHeight,
    paragraphSpacing: node.paragraphSpacing,
    paragraphIndent: node.paragraphIndent,
    textAlignHorizontal: node.textAlignHorizontal,
    textAlignVertical: node.textAlignVertical,
    
    // Character styles (with position and character)
    characterStyles: [],
    
    // Word-level styles for better mapping
    wordStyles: [],
    
    // Summary for logging
    summary: {
      totalCharacters: node.characters.length,
      uniqueColors: 0,
      uniqueFonts: 0
    }
  };
  
  // Get character-by-character styling
  try {
    const text = node.characters;
    const uniqueColors = new Set();
    const uniqueFonts = new Set();
    
    // First pass: capture character styles
    for (let i = 0; i < text.length; i++) {
      const fills = deepCloneWithColorNormalization(node.getRangeFills(i, i+1));
      const fontName = node.getRangeFontName(i, i+1);
      
      // Track unique styles
      if (fills && fills.length > 0 && fills[0].type === 'SOLID') {
        const colorKey = `${fills[0].color.r},${fills[0].color.g},${fills[0].color.b}`;
        uniqueColors.add(colorKey);
      }
      
      if (fontName) {
        uniqueFonts.add(`${fontName.family}-${fontName.style}`);
      }
      
      styles.characterStyles.push({
        position: i,
        character: text[i],
        fontName: fontName,
        fontSize: node.getRangeFontSize(i, i+1),
        fills: fills,
        textDecoration: node.getRangeTextDecoration(i, i+1)
      });
    }
    
    // Second pass: group by words for better mapping
    const words = text.split(/(\s+)/);
    let position = 0;
    
    for (const word of words) {
      if (word.length > 0) {
        const wordStyle = {
          text: word,
          start: position,
          end: position + word.length,
          styles: {}
        };
        
        // Get the dominant style for this word
        const firstCharStyle = styles.characterStyles[position];
        if (firstCharStyle) {
          wordStyle.styles = {
            fontName: firstCharStyle.fontName,
            fontSize: firstCharStyle.fontSize,
            fills: firstCharStyle.fills,
            textDecoration: firstCharStyle.textDecoration
          };
        }
        
        styles.wordStyles.push(wordStyle);
      }
      position += word.length;
    }
    
    // Update summary
    styles.summary.uniqueColors = uniqueColors.size;
    styles.summary.uniqueFonts = uniqueFonts.size;
    
  } catch (error) {
    console.error('[DEBUG] ❌ Error capturing complete styles:', error);
  }
  
  return styles;
}

// Helper function to deep clone with color normalization
function deepCloneWithColorNormalization(fills) {
  if (!fills || !Array.isArray(fills)) return fills;
  
  return fills.map(fill => {
    // Deep clone the fill
    const newFill = JSON.parse(JSON.stringify(fill));
    
    // Normalize color values if this is a solid fill
    if (newFill.type === 'SOLID' && newFill.color) {
      newFill.color.r = Math.max(0, Math.min(1, newFill.color.r));
      newFill.color.g = Math.max(0, Math.min(1, newFill.color.g));
      newFill.color.b = Math.max(0, Math.min(1, newFill.color.b));
      if (typeof newFill.color.a !== 'undefined') {
        newFill.color.a = Math.max(0, Math.min(1, newFill.color.a));
      } else {
        newFill.color.a = 1; // Default alpha if not specified
      }
    }
    
    return newFill;
  });
}

// Add this simple function to apply styles
async function applyAllNodeStyles(node, styles, translatedText) {
  console.log('Applying styles to:', translatedText);
  
  try {
    // Load font first
    try {
      await figma.loadFontAsync(styles.fontName);
    } catch (e) {
      console.log('Error loading font:', e);
      await figma.loadFontAsync({ family: "Inter", style: "Regular" });
    }
    
    // Set the text
    node.characters = translatedText;
    
    // Apply node-level properties
    try {
      node.fontSize = styles.fontSize;
      node.fills = styles.fills;
      node.textCase = styles.textCase;
      node.textDecoration = styles.textDecoration;
      node.letterSpacing = styles.letterSpacing;
      node.lineHeight = styles.lineHeight;
      node.paragraphSpacing = styles.paragraphSpacing;
      node.paragraphIndent = styles.paragraphIndent;
      node.textAlignHorizontal = styles.textAlignHorizontal;
      node.textAlignVertical = styles.textAlignVertical;
    } catch (e) {
      console.log('Error setting node properties:', e);
    }
    
    // Apply character-level styling based on original proportion
    try {
      const originalLength = styles.characterStyles.length;
      const newLength = translatedText.length;
      
      // Simple proportion mapping
      for (let i = 0; i < translatedText.length; i++) {
        // Map position proportionally
        const originalPos = Math.floor((i / newLength) * originalLength);
        
        if (originalPos < originalLength) {
          const originalStyle = styles.characterStyles[originalPos];
          
          // Apply font
          if (originalStyle.fontName) {
            try {
              await figma.loadFontAsync(originalStyle.fontName);
              node.setRangeFontName(i, i+1, originalStyle.fontName);
            } catch (e) {
              // Skip if font fails
            }
          }
          
          // Apply color
          if (originalStyle.fills) {
            node.setRangeFills(i, i+1, originalStyle.fills);
          }
        }
      }
    } catch (e) {
      console.log('Error applying character styles:', e);
    }
  } catch (e) {
    console.log('Error in applyAllNodeStyles:', e);
  }
}

// Add this simple direct translation function that skips fancy style preservation
async function applySimpleTranslation(node, translatedText) {
  console.log(`SIMPLE TRANSLATION: "${node.characters}" => "${translatedText}"`);
  
  // Store original styling
  const originalFills = node.fills;
  const originalFontName = node.fontName;
  const originalFontSize = node.fontSize;
  
  try {
    // Load font
    await figma.loadFontAsync(originalFontName);
    
    // Apply translation
    node.characters = translatedText;
    
    // Reapply basic styling
    node.fills = originalFills;
    node.fontName = originalFontName;
    node.fontSize = originalFontSize;
    
    return true;
  } catch (e) {
    console.error('Simple translation error:', e);
    return false;
  }
}

// Add this enhanced version that preserves styles
function translateWithStylePreservation(node, targetLang) {
  if (node.type !== "TEXT") return;
  
  console.log("Using enhanced translation with style preservation for:", node.characters);
  
  // First capture all styles
  const styles = captureStyles(node);
  
  // Then translate and apply with style preservation
  figma.loadFontAsync(node.fontName)
    .then(() => {
      // Get translation
      return fetch('http://localhost:3000/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: node.characters, targetLang })
      });
    })
    .then(response => response.json())
    .then(async data => {
      if (data.translation) {
        console.log("Translation successful with preserved styles:", data.translation);
        
        // Apply translation with preserved styles
        await applyStyles(node, styles, data.translation);
        
        // Handle RTL if needed
        const isRTL = isRTLLanguage(targetLang, data.translation);
        if (isRTL) {
          handleRTLProperties(node, targetLang, data.translation);
        }
      }
    })
    .catch(err => console.error("Style-preserving translation error:", err));
}

// Client-side translation cache
const clientTranslationCache = {
  // Structure: { [targetLang]: { [sourceText]: translatedText } }
};

// Add cache management functions
function clearTranslationCache(targetLang = null) {
  if (targetLang) {
    // Clear specific language
    if (clientTranslationCache[targetLang]) {
      console.log(`Clearing client cache for ${targetLang}`);
      delete clientTranslationCache[targetLang];
    }
    
    // Also clear on server
    return fetch(`http://localhost:3000/cache/${targetLang}`, {
      method: 'DELETE'
    })
    .then(response => response.json())
    .then(data => {
      console.log(`Server cache cleared for ${targetLang}:`, data.message);
      return data;
    })
    .catch(err => {
      console.error('Failed to clear server cache:', err);
    });
  } else {
    // Clear all languages
    console.log('Clearing all client cache');
    Object.keys(clientTranslationCache).forEach(lang => {
      delete clientTranslationCache[lang];
    });
    
    // Also clear on server
    return fetch('http://localhost:3000/cache', {
      method: 'DELETE'
    })
    .then(response => response.json())
    .then(data => {
      console.log('Server cache cleared:', data.message);
      return data;
    })
    .catch(err => {
      console.error('Failed to clear server cache:', err);
    });
  }
}

// Function to translate text with style preservation instructions
async function translateText(originalText, targetLang, styleRanges = [], forceRetranslate = false) {
  if (!originalText || originalText.trim() === '') {
    console.log(`[DEBUG] ⚠️ Empty text, skipping translation`);
    return originalText;
  }

  console.log(`[DEBUG] 🌍 Requesting translation for: "${originalText}" to ${targetLang}`);
  
  try {
    // Prepare style information if preserving styles and styleRanges provided
    const styleInfo = styleRanges.length > 0 ? styleRanges.map(sr => {
      return {
        text: originalText.substring(sr.range.start, sr.range.end),
        color: sr.color || '#0000FF'
      };
    }) : null;
    
    // Try ports 3000-3005 until we find a working server
    let serverError = null;
    for (let port = 3000; port <= 3005; port++) {
      try {
        const response = await fetch(`http://localhost:${port}/translate`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            text: originalText,
            targetLang: targetLang,
            forceRetranslate: forceRetranslate,
            styleInfo: styleInfo
          })
        });

        if (!response.ok) {
          throw new Error(`Translation API error: ${response.status}`);
        }

        // If we get here, the request succeeded
        const data = await response.json();
        console.log(`[DEBUG] 🌍 Received translation from port ${port}: "${data.translation}"`);
        
        if (data.styleMapping) {
          console.log(`[DEBUG] 🎨 Received style mapping:`, JSON.stringify(data.styleMapping));
        }
        
        return {
          translatedText: data.translation,
          styleMapping: data.styleMapping || null
        };
      } catch (portError) {
        console.log(`[DEBUG] ⚠️ Failed to connect to server on port ${port}: ${portError.message}`);
        serverError = portError;
        // Continue to try the next port
      }
    }
    
    // If we get here, all ports failed
    throw serverError || new Error('Could not connect to any translation server port (3000-3005)');
  } catch (error) {
    console.log(`[DEBUG] ❌ Translation error: ${error.message}`);
    
    // Create a fallback translation for demonstration purposes
    const fallbackText = createFallbackTranslation(originalText, targetLang);
    console.log(`[DEBUG] ⚠️ Using fallback text: "${fallbackText}"`);
    
    return {
      translatedText: fallbackText,
      error: error.message
    };
  }
}

// Global cache for style mappings returned by the translation API
const translationStyleMappings = {};

// Core translation function
function translateText(originalText, targetLang) {
  return fetch('http://localhost:3000/translate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: originalText, targetLang })
  })
  .then(response => response.json())
  .then(data => {
    console.log('Translation received:', data.translation);
    return data.translation;
  })
  .catch(error => {
    console.error('Translation error:', error);
    return originalText; // Return original if translation fails
  });
}

// Enhanced style preservation with character-by-character styles
function captureStyles(textNode) {
  const styles = {
    // Node-level styles
    fontName: textNode.fontName,
    fontSize: textNode.fontSize,
    fills: textNode.fills,
    textDecoration: textNode.textDecoration,
    letterSpacing: textNode.letterSpacing,
    lineHeight: textNode.lineHeight,
    textCase: textNode.textCase,
    paragraphSpacing: textNode.paragraphSpacing,
    paragraphIndent: textNode.paragraphIndent,
    textAlignHorizontal: textNode.textAlignHorizontal,
    textAlignVertical: textNode.textAlignVertical,
    
    // Character-level styles
    charStyles: []
  };
  
  // Capture character-by-character styles for improved preservation
  try {
    for (let i = 0; i < textNode.characters.length; i++) {
      styles.charStyles.push({
        position: i,
        fontName: textNode.getRangeFontName(i, i+1),
        fontSize: textNode.getRangeFontSize(i, i+1),
        fills: textNode.getRangeFills(i, i+1),
        textDecoration: textNode.getRangeTextDecoration(i, i+1),
        letterSpacing: textNode.getRangeLetterSpacing(i, i+1),
        lineHeight: textNode.getRangeLineHeight(i, i+1),
        textCase: textNode.getRangeTextCase(i, i+1)
      });
    }
  } catch (e) {
    console.warn('Error capturing character styles:', e);
  }
  
  return styles;
}

async function applyStyles(textNode, styles, translatedText = null) {
  // Apply the translation if provided
  if (translatedText) {
    textNode.characters = translatedText;
  }
  
  // Apply node-level styles
  textNode.fontSize = styles.fontSize;
  textNode.fills = styles.fills;
  textNode.textDecoration = styles.textDecoration;
  textNode.letterSpacing = styles.letterSpacing;
  textNode.lineHeight = styles.lineHeight;
  textNode.textCase = styles.textCase;
  textNode.paragraphSpacing = styles.paragraphSpacing;
  textNode.paragraphIndent = styles.paragraphIndent;
  textNode.textAlignHorizontal = styles.textAlignHorizontal;
  textNode.textAlignVertical = styles.textAlignVertical;
  
  // Apply character-level styles if we have them and a translation
  if (translatedText && styles.charStyles && styles.charStyles.length > 0) {
    try {
      // Get words from both original and translated text
      const originalText = styles.charStyles.map(s => textNode.characters[s.position] || '').join('');
      const originalWords = originalText.match(/\S+/g) || [];
      const translatedWords = translatedText.match(/\S+/g) || [];
      
      if (originalWords.length > 0 && translatedWords.length > 0) {
        let currentPos = 0;
        
        for (let i = 0; i < Math.min(translatedWords.length, originalWords.length); i++) {
          const word = translatedWords[i];
          const wordPos = translatedText.indexOf(word, currentPos);
          
          if (wordPos >= 0) {
            // Get original word position and its style
            const originalWordIndex = Math.min(i, originalWords.length - 1);
            const originalWordPos = originalText.indexOf(originalWords[originalWordIndex]);
            
            if (originalWordPos >= 0 && originalWordPos < styles.charStyles.length) {
              // Apply styles from corresponding position
              const style = styles.charStyles[originalWordPos];
              try {
                if (style.fontName) {
                  await figma.loadFontAsync(style.fontName);
                  textNode.setRangeFontName(wordPos, wordPos + word.length, style.fontName);
                }
                if (style.fills) {
                  textNode.setRangeFills(wordPos, wordPos + word.length, style.fills);
                }
                if (style.fontSize) {
                  textNode.setRangeFontSize(wordPos, wordPos + word.length, style.fontSize);
                }
                if (style.textDecoration) {
                  textNode.setRangeTextDecoration(wordPos, wordPos + word.length, style.textDecoration);
                }
              } catch (e) {
                console.warn('Error applying character style:', e);
              }
            }
            currentPos = wordPos + word.length;
          }
        }
      }
    } catch (e) {
      console.error('Error applying character styles:', e);
    }
  }
  
  // Load and apply font
  try {
    await figma.loadFontAsync(styles.fontName);
    textNode.fontName = styles.fontName;
  } catch (e) {
    console.warn('Error loading font, using fallback:', e);
    await figma.loadFontAsync({ family: "Inter", style: "Regular" });
    textNode.fontName = { family: "Inter", style: "Regular" };
  }
}

// Detach instances recursively
function detachInstancesIfNeeded(node) {
  if (node.type === "INSTANCE") {
    console.log("Detaching instance:", node.name);
    try {
      // Detach the instance
      return node.detachInstance();
    } catch (error) {
      console.error("Error detaching instance:", error);
      return node;
    }
  }
  return node;
}

// Handle RTL languages
function handleRTL(node, isRTL) {
  if (isRTL) {
    node.textAlignHorizontal = "RIGHT";
    if ('textDirection' in node) {
      node.textDirection = "RTL";
    }
  }
}

// Main processing function
function processNode(node, targetLang, progressCallback, forceRetranslate = false) {
  // First detach instances
  node = detachInstancesIfNeeded(node);
  
  // Then process text nodes
  if (node.type === "TEXT") {
    const originalText = node.characters;
    if (!originalText.trim()) return Promise.resolve();
    
    console.log("Processing text node:", originalText);
    
    // Capture original styles with enhanced detail
    const styles = captureStyles(node);
    
    // Load font first
    return figma.loadFontAsync(node.fontName)
      .then(() => {
        // Get translation
        return translateText(originalText, targetLang, forceRetranslate);
      })
      .then(async translatedText => {
        // Apply translation with style preservation in one step
        await applyStyles(node, styles, translatedText);
        
        // Handle RTL if needed
        const isRTL = targetLang === 'ar' || targetLang === 'he' || isRTLLanguage(targetLang, translatedText);
        handleRTL(node, isRTL);
        
        // Notify progress
        if (progressCallback) {
          progressCallback(originalText, translatedText);
        }
      })
      .catch(error => {
        console.error("Error processing text node:", error);
      });
  }
  
  // Process children recursively
  if (node.children) {
    const promises = [];
    node.children.forEach(child => {
      promises.push(processNode(child, targetLang, progressCallback, forceRetranslate));
    });
    return Promise.all(promises);
  }
  
  return Promise.resolve();
}

// Main entry point function
function startTranslation(selection, targetLang, forceRetranslate = false) {
  if (!selection || selection.length === 0) {
    figma.notify("Please select at least one node");
    return;
  }
  
  console.log("Starting translation to", targetLang);
  const totalNodes = countTextNodes(selection[0]);
  let processedNodes = 0;
  
  // Create a callback for progress updates
  const progressCallback = (originalText, translatedText) => {
    processedNodes++;
    const progress = Math.round((processedNodes / totalNodes) * 100);
    figma.ui.postMessage({
      type: 'translationProgress',
      progress,
      originalText,
      translatedText
    });
  };
  
  // Clone the selection
  const clone = selection[0].clone();
  console.log("Created clone:", clone.name);
  
  // Position the clone next to the original
  clone.x = selection[0].x + selection[0].width + 50;
  clone.y = selection[0].y;
  
  // Process the clone
  processNode(clone, targetLang, progressCallback, forceRetranslate)
    .then(() => {
      console.log("Translation completed");
      figma.ui.postMessage({ type: 'translationComplete' });
    })
    .catch(error => {
      console.error("Translation failed:", error);
      figma.ui.postMessage({ type: 'translationError', error: error.message });
    });
}

async function loadRunFont(styleRange) {
  if (!styleRange.fontName) return;
  try {
    await figma.loadFontAsync(styleRange.fontName);
  } catch (e) {
    console.warn('Failed to load font:', styleRange.fontName, e);
    await figma.loadFontAsync({ family: "Inter", style: "Regular" });
  }
}

// Preserve text styles during translation
async function preserveTextStyles(node, originalText, translatedText, targetLang, styleMapping) {
  try {
    console.log(`[DEBUG] 🎨 Preserving text styles for translation to ${targetLang}`);
    
    // Capture the original node styles before modifying it
    const originalStyles = captureCompleteNodeStyles(node);
    console.log(`[DEBUG] 🎨 Captured original styles:`, JSON.stringify(originalStyles.summary));
    
    // Load the font before applying any styles
    await figma.loadFontAsync(node.fontName);
    
    // First set the plain translated text
    node.characters = translatedText;
    
    // Find style ranges in the original text
    const styleRanges = await findStyleRanges(node, originalText);
    console.log(`[DEBUG] 🎨 Style ranges found in original text:`, 
      JSON.stringify(styleRanges.map(sr => ({
        text: sr.range ? originalText.substring(sr.range.start, sr.range.end) : "unknown",
        start: sr.range && sr.range.start,
        end: sr.range && sr.range.end,
        isSpecial: sr.isSpecial
      })))
    );
    
    // If we have Claude-provided style mappings, try to apply them first
    let stylesApplied = false;
    if (styleMapping && styleMapping.length > 0) {
      console.log(`[DEBUG] 🎨 Using Claude-provided style mappings (${styleMapping.length} mappings)`);
      
      try {
        // Apply each style mapping from Claude
        for (const mapping of styleMapping) {
          console.log(`[DEBUG] 🎨 Processing mapping:`, JSON.stringify(mapping));
          
          // Find the original style that corresponds to this mapping
          const matchingRange = styleRanges.find(range => {
            if (!range || !range.range) return false;
            const rangeText = originalText.substring(range.range.start, range.range.end);
            // More flexible matching - check if either text contains the other
            const isMatch = rangeText.includes(mapping.originalText) || 
                           mapping.originalText.includes(rangeText);
            console.log(`[DEBUG] 🎨 Checking if "${rangeText}" matches "${mapping.originalText}": ${isMatch}`);
            return isMatch;
          });
          
          if (matchingRange && matchingRange.style) {
            console.log(`[DEBUG] 🎨 Applying style to "${mapping.translatedText}" based on Claude's mapping`);
            
            // Find the position of the translated text to style - use more flexible matching
            let startPos = translatedText.indexOf(mapping.translatedText);
            
            // If exact match fails, try case-insensitive match
            if (startPos === -1) {
              const lowerTranslatedText = translatedText.toLowerCase();
              const lowerMappingText = mapping.translatedText.toLowerCase();
              startPos = lowerTranslatedText.indexOf(lowerMappingText);
              
              if (startPos !== -1) {
                console.log(`[DEBUG] 🎨 Found case-insensitive match for "${mapping.translatedText}"`);
              }
            }
            
            // If still no match, try fuzzy matching by words
            if (startPos === -1) {
              const translatedWords = translatedText.split(/\s+/);
              const mappingWords = mapping.translatedText.split(/\s+/);
              
              // Try to find a sequence of words that match
              for (let i = 0; i <= translatedWords.length - mappingWords.length; i++) {
                const potentialMatch = translatedWords.slice(i, i + mappingWords.length).join(' ');
                if (potentialMatch.toLowerCase().includes(mappingWords[0].toLowerCase())) {
                  // Calculate the position in the original string
                  startPos = translatedText.indexOf(potentialMatch);
                  console.log(`[DEBUG] 🎨 Found fuzzy match: "${potentialMatch}" for "${mapping.translatedText}"`);
                  break;
                }
              }
            }
            
            if (startPos !== -1) {
              const endPos = startPos + (mapping.translatedText.length || 1);
              
              // Ensure we have valid style information with color
              const styleToApply = { ...matchingRange.style };
              
              // Log the style we're about to apply
              console.log(`[DEBUG] 🎨 Style to apply:`, JSON.stringify({
                fills: styleToApply.fills ? describeFill(styleToApply.fills) : 'none',
                fontName: styleToApply.fontName,
                fontSize: styleToApply.fontSize
              }));
              
              await applyStyleToRange(node, startPos, endPos, styleToApply);
              stylesApplied = true;
            } else {
              console.log(`[DEBUG] ⚠️ Could not find "${mapping.translatedText}" in the translated text`);
            }
          } else {
            console.log(`[DEBUG] ⚠️ Could not find matching style for "${mapping.originalText}"`);
          }
        }
        
        if (stylesApplied) {
          console.log(`[DEBUG] 🎨 Successfully applied Claude-provided style mappings`);
          return true;
        }
      } catch (error) {
        console.log(`[DEBUG] ❌ Error applying Claude-provided style mappings: ${error.message}`);
        // If Claude-based styling fails, fall back to our regular approach
      }
    }
    
    // If we couldn't apply Claude-provided mappings or if none were provided,
    // fall back to our regular style-preservation approach
    console.log(`[DEBUG] 🎨 Using fallback style preservation approach`);
    
    // Use existing styleRanges found earlier
    // Safety check for styleRanges
    if (!styleRanges || !Array.isArray(styleRanges) || styleRanges.length === 0) {
      console.log(`[DEBUG] ⚠️ No style ranges found, applying translated text without styles`);
      try {
        // Just set the text without styles
        node.characters = translatedText;
        return true;
      } catch (error) {
        console.log(`[DEBUG] ❌ Error setting translated text: ${error.message}`);
        return false;
      }
    }
    
    console.log(`[DEBUG] 🎨 Found ${styleRanges.length} style ranges in original text`);
    
    try {
      // Check if any special language handlers need to be applied
      const handledBySpecial = await handleSpecialTextPatterns(node, translatedText, originalText, styleRanges, targetLang);
      
      // If not handled by special patterns, use the regular mapping
      if (!handledBySpecial) {
        console.log(`[DEBUG] 🎨 Mapping styles to translated text using standard approach`);
        await mapStylesToTranslation(node, styleRanges, originalText, translatedText, targetLang);
      }
      
      return true;
    } catch (error) {
      console.log(`[DEBUG] ❌ Error preserving styles: ${error.message}`);
      
      // Fallback: just set the text without styles
      try {
        node.characters = translatedText;
        return true;
      } catch (fallbackError) {
        console.log(`[DEBUG] ❌ Fallback failed: ${fallbackError.message}`);
        return false;
      }
    }
  } catch (error) {
    console.log(`[DEBUG] ❌ Error in preserveTextStyles: ${error.message}`);
    return false;
  }
}

// Find all distinct style ranges in text
async function findStyleRanges(node, text) {
  console.log("[DEBUG] 🔍 Finding style ranges for:", text ? text.substring(0, 30) + "..." : "empty text");
  const ranges = [];
  
  // Safety check for empty or undefined text
  if (!text || text.length === 0) {
    console.log("[DEBUG] ⚠️ Warning: Empty text provided to findStyleRanges");
    return [];
  }
  
  try {
    // Safety check for node
    if (!node || node.type !== "TEXT") {
      console.log("[DEBUG] ⚠️ Warning: Invalid node provided to findStyleRanges");
      return [];
    }
    
    let currentStyle = null;
    let rangeStart = 0;
    
    // Check each character for style changes
    for (let i = 0; i < text.length; i++) {
      // Skip whitespace when determining styles
      if (/\s/.test(text[i]) && i > rangeStart) continue;
      
      try {
        const style = {
          fontName: node.getRangeFontName(i, i + 1),
          fontSize: node.getRangeFontSize(i, i + 1),
          fills: node.getRangeFills(i, i + 1),
          textDecoration: node.getRangeTextDecoration(i, i + 1)
        };
        
        const styleSignature = getStyleSignature(style);
        
        if (!currentStyle) {
          // Replace spread operator with manual property assignment
          currentStyle = {
            fontName: style.fontName,
            fontSize: style.fontSize,
            fills: style.fills,
            textDecoration: style.textDecoration,
            signature: styleSignature
          };
        } else if (styleSignature !== currentStyle.signature) {
          // Style changed, record the previous range
          if (i > rangeStart) {
            ranges.push({
              text: text.substring(rangeStart, i),
              start: rangeStart,
              end: i,
              style: currentStyle,
              signature: currentStyle.signature,
              // Add explicit range property for consistency
              range: {
                start: rangeStart,
                end: i
              }
            });
          }
          
          // Start new range - avoid spread operator
          currentStyle = {
            fontName: style.fontName,
            fontSize: style.fontSize,
            fills: style.fills,
            textDecoration: style.textDecoration,
            signature: styleSignature
          };
          rangeStart = i;
        }
      } catch (charError) {
        console.log(`[DEBUG] ⚠️ Error processing character at position ${i}: ${charError.message}`);
        // Continue with next character
      }
    }
    
    // Add the final range
    if (rangeStart < text.length && currentStyle) {
      ranges.push({
        text: text.substring(rangeStart),
        start: rangeStart,
        end: text.length,
        style: currentStyle,
        signature: currentStyle.signature,
        // Add explicit range property for consistency
        range: {
          start: rangeStart,
          end: text.length
        }
      });
    }
    
    // Identify the most common style (likely the default)
    if (ranges.length > 0) {
      const styleCounts = {};
      let maxCount = 0;
      let defaultSignature = ranges[0].signature;
      
      ranges.forEach(range => {
        if (!styleCounts[range.signature]) {
          styleCounts[range.signature] = 0;
        }
        styleCounts[range.signature] += range.text.length;
        
        if (styleCounts[range.signature] > maxCount) {
          maxCount = styleCounts[range.signature];
          defaultSignature = range.signature;
        }
      });
      
      // Mark default and special ranges
      ranges.forEach(range => {
        range.isDefault = range.signature === defaultSignature;
        range.isSpecial = !range.isDefault;
        
        // Ensure the range object is correctly structured for later use
        range.range = {
          start: range.start,
          end: range.end
        };
      });
    }
  } catch (err) {
    console.log("[DEBUG] ⚠️ Error in findStyleRanges:", err);
    // Return an empty array in case of error
    return [];
  }
  
  // Log style ranges for debugging
  console.log("Style ranges:", ranges.map(function(r) {
    return {
      text: r.text,
      isDefault: r.isDefault,
      fillColor: describeFill(r.style.fills)
    };
  }));
  
  return ranges;
}

// Get a string signature for a style (for comparison)
function getStyleSignature(style) {
  // Avoid optional chaining
  let fillType = null;
  let fillColor = null;
  
  if (style.fills && style.fills[0]) {
    fillType = style.fills[0].type || null;
    
    if (style.fills[0].color) {
      fillColor = [
        style.fills[0].color.r, 
        style.fills[0].color.g, 
        style.fills[0].color.b
      ];
    }
  }
  
  return JSON.stringify({
    fontName: style.fontName,
    fontSize: style.fontSize,
    fillType: fillType,
    fillColor: fillColor,
    textDecoration: style.textDecoration
  });
}

// Get a human-readable description of a fill
function describeFill(fills) {
  if (!fills || !fills[0] || !fills[0].color) return 'none';
  const c = fills[0].color;
  return `RGB(${Math.round(c.r*255)}, ${Math.round(c.g*255)}, ${Math.round(c.b*255)})`;
}

// Get the default style from style ranges
function getDefaultStyle(styleRanges, node) {
  try {
    // Safety check for inputs
    if (!styleRanges || !Array.isArray(styleRanges) || styleRanges.length === 0) {
      console.log(`[DEBUG] ⚠️ No style ranges provided, using node's default style`);
      return node ? {
        fontName: node.fontName,
        fontSize: node.fontSize,
        fills: node.fills,
        textDecoration: node.textDecoration
      } : {};
    }
    
    // Find the first default style
    const defaultRange = styleRanges.find(r => r && r.isDefault);
    if (defaultRange && defaultRange.style) {
      console.log(`[DEBUG] 🎨 Using default style from range: "${defaultRange.text ? defaultRange.text.substring(0, 20) : ''}..."`);
      return defaultRange.style;
    }
    
    // Fallback to first style if no default marked
    if (styleRanges[0] && styleRanges[0].style) {
      console.log(`[DEBUG] 🎨 No default style found, using first style range as default`);
      return styleRanges[0].style;
    }
    
    // Fallback to node's default style
    console.log(`[DEBUG] 🎨 Falling back to node's default style`);
    return node ? {
      fontName: node.fontName,
      fontSize: node.fontSize,
      fills: node.fills,
      textDecoration: node.textDecoration
    } : {};
  } catch (error) {
    console.log(`[DEBUG] ❌ Error in getDefaultStyle: ${error.message}`);
    // Return an empty object as last resort
    return {};
  }
}

// Map styles from original text to translated text
async function mapStylesToTranslation(node, styleRanges, originalText, translatedText, targetLang) {
  try {
    // Safety checks for inputs
    if (!node || !styleRanges || !originalText || !translatedText) {
      console.log(`[DEBUG] ⚠️ Missing required parameters in mapStylesToTranslation`);
      return;
    }
    
    // Only process special (non-default) styles
    const specialRanges = styleRanges.filter(r => r && r.isSpecial);
    if (specialRanges.length === 0) {
      console.log(`[DEBUG] 🗺️ No special style ranges to map`);
      return;
    }
    
    console.log(`[DEBUG] 🗺️ Mapping ${specialRanges.length} special style ranges to translated text`);
    console.log(`[DEBUG] 🗺️ Original: "${originalText}"`);
    console.log(`[DEBUG] 🗺️ Translated: "${translatedText}"`);
    
    // Try special pattern handling first (like "Reading lists")
    const handledBySpecial = await handleSpecialTextPatterns(node, translatedText, originalText, styleRanges, targetLang);
    if (handledBySpecial) {
      console.log(`[DEBUG] 🗺️ Text was handled by special pattern handler, skipping standard mapping`);
      return;
    }
    
    // Standard approach for when special handling isn't applicable
    // Analyze the structure of original text
    const originalStructure = analyzeTextStructure(originalText);
    const translatedStructure = analyzeTextStructure(translatedText);
    
    // For each special style range, find the corresponding position in translated text
    for (const range of specialRanges) {
      if (!range.range) {
        console.log(`[DEBUG] ⚠️ Style range has no valid range property, skipping`);
        continue;
      }
      
      try {
        const rangeText = originalText.substring(range.range.start, range.range.end);
        console.log(`[DEBUG] 🗺️ Mapping style for "${rangeText}" to translated text`);
        
        const correspondingRange = findCorrespondingPositions(
          range.range, 
          originalText, 
          translatedText,
          originalStructure,
          translatedStructure,
          targetLang
        );
        
        if (correspondingRange) {
          console.log(`[DEBUG] 🗺️ Found corresponding position ${correspondingRange.start}-${correspondingRange.end}`);
          await applyStyleToRange(node, correspondingRange, range.style);
        } else {
          console.log(`[DEBUG] ⚠️ Could not find corresponding position for "${rangeText}"`);
        }
      } catch (error) {
        console.log(`[DEBUG] ❌ Error mapping style: ${error.message}`);
      }
    }
  } catch (error) {
    console.log(`[DEBUG] ❌ Error in mapStylesToTranslation: ${error.message}`);
  }
}

// Analyze structure of text to help with mapping
function analyzeTextStructure(text) {
  const words = text.match(/\S+/g) || [];
  const firstWord = words[0] || '';
  const lastWord = words[words.length - 1] || '';
  
  // Find segments like "xxx with yyy" or "xxx using yyy"
  const withMatch = text.match(/(.+?)\s+(with|using|by|in|on|for|to)\s+(.+)/i);
  let beforeConnector = null;
  let connector = null;
  let afterConnector = null;
  
  if (withMatch) {
    beforeConnector = withMatch[1].trim();
    connector = withMatch[2].trim();
    afterConnector = withMatch[3].trim();
  }
  
  return {
    fullText: text,
    wordCount: words.length,
    words,
    firstWord,
    lastWord,
    beforeConnector,
    connector,
    afterConnector,
    hasConnector: !!withMatch
  };
}

// Find corresponding positions in translated text
function findCorrespondingPositions(range, originalText, translatedText, originalStructure, translatedStructure, targetLang) {
  const rangeText = range.text.trim();
  
  // Special case for "Reading lists" scenarios for any language
  if (languageConfig.hasReadingListPattern(rangeText, targetLang)) {
    console.log(`[DEBUG] 🌍 Special handling for ${targetLang} pattern in findCorrespondingPositions`);
    
    // Try to find language equivalent using our helper
    const translationInfo = findReadingListsInTranslation(translatedText, targetLang);
    
    if (translationInfo && translationInfo.found) {
      console.log(`[DEBUG] 🌍 Found equivalent in ${targetLang} at positions ${translationInfo.start}-${translationInfo.end}: "${translationInfo.text}"`);
      return {
        start: translationInfo.start,
        end: translationInfo.end
      };
    }
  }
  
  // Case 1: Special style at beginning of text
  if (range.start === 0 || originalText.indexOf(rangeText) === 0) {
    // If styled text is at start, map to beginning of translation
    const rangeWords = rangeText.match(/\S+/g);
    const wordCount = rangeWords ? rangeWords.length : 1;
    const translatedWordCount = Math.min(wordCount, Math.ceil(translatedStructure.wordCount * 0.3));
    const endWord = translatedStructure.words[translatedWordCount - 1] || '';
    
    console.log(`[DEBUG] 🔍 Style at beginning: mapping to first ${translatedWordCount} words`);
    return {
      start: 0,
      end: translatedText.indexOf(endWord) + endWord.length
    };
  }
  
  // Case 2: Special style at end of text
  if (range.end === originalText.length || 
      originalText.lastIndexOf(rangeText) + rangeText.length === originalText.length) {
    // If styled text is at end, map to end of translation
    const rangeWords = rangeText.match(/\S+/g);
    const wordCount = rangeWords ? rangeWords.length : 1;
    const startWordIndex = Math.max(0, translatedStructure.words.length - wordCount);
    const startWord = translatedStructure.words[startWordIndex] || '';
    
    console.log(`[DEBUG] 🔍 Style at end: mapping to last ${wordCount} words`);
    return {
      start: translatedText.lastIndexOf(startWord),
      end: translatedText.length
    };
  }
  
  // Case 3: If text has a connector like "with", "using", etc.
  if (originalStructure.hasConnector && translatedStructure.hasConnector) {
    console.log(`[DEBUG] 🔍 Text contains connector: "${originalStructure.connector}" / "${translatedStructure.connector}"`);
    // Check if styled range is before or after connector
    if (rangeText === originalStructure.beforeConnector) {
      console.log(`[DEBUG] 🔍 Style applied to text before connector`);
      return {
        start: 0,
        end: translatedText.indexOf(translatedStructure.connector || '')
      };
    }
    
    if (rangeText === originalStructure.afterConnector) {
      console.log(`[DEBUG] 🔍 Style applied to text after connector`);
      const connectorPos = translatedText.indexOf(translatedStructure.connector || '');
      if (connectorPos >= 0) {
        const connectorLength = translatedStructure.connector ? translatedStructure.connector.length : 0;
        const afterConnectorPos = connectorPos + connectorLength;
        return {
          start: afterConnectorPos,
          end: translatedText.length
        };
      }
    }
  }
  
  // Case 4: Try to map based on relative position
  const relativeStart = range.start / originalText.length;
  const relativeEnd = range.end / originalText.length;
  
  const approxStart = Math.floor(relativeStart * translatedText.length);
  const approxEnd = Math.ceil(relativeEnd * translatedText.length);
  
  // Find word boundaries
  const wordBefore = translatedText.lastIndexOf(' ', approxStart) + 1;
  const wordAfter = translatedText.indexOf(' ', approxEnd);
  
  // Use relative positioning by default
  return {
    start: wordBefore >= 0 ? wordBefore : 0,
    end: wordAfter >= 0 ? wordAfter : translatedText.length
  };
}

// Apply style to a specific text range
async function applyStyleToRange(node, range, style) {
  try {
    // Handle both range object format and separate start/end parameters
    const start = typeof range === 'object' ? range.start : range;
    const end = typeof range === 'object' ? range.end : arguments[2];
    const styleToApply = typeof range === 'object' ? style : arguments[3];
    
    // Enhanced validation
    if (typeof start !== 'number' || typeof end !== 'number') {
      console.log(`[DEBUG] ❌ Range values must be numbers: ${start}, ${end}`);
      return false;
    }
    
    if (start >= end || start < 0 || !styleToApply) {
      console.log(`[DEBUG] ❌ Invalid range or style in applyStyleToRange`, { start, end, hasStyle: !!styleToApply });
      return false;
    }
    
    if (end > node.characters.length) {
      console.log(`[DEBUG] ⚠️ End range (${end}) exceeds text length (${node.characters.length}), adjusting...`);
      end = Math.min(end, node.characters.length);
    }

    console.log(`[DEBUG] 🖌️ Applying style to range ${start}-${end} on node "${node.characters.substring(0, 30)}..."`);
    
    if (!styleToApply) {
      console.log(`[DEBUG] ❌ No style to apply`);
      return false;
    }
    
    // Check if we have a valid text node
    if (node.type !== "TEXT") {
      console.log(`[DEBUG] ❌ Node is not a text node (type: ${node.type})`);
      return false;
    }
    
    // Log style details for debugging
    console.log(`[DEBUG] 🖌️ Style contains properties:`, Object.keys(styleToApply).join(', '));
    
    // Apply each style property individually with error handling
    if (styleToApply.fontName) {
      try {
        console.log(`[DEBUG] 🖌️ Loading font: ${styleToApply.fontName.family}, ${styleToApply.fontName.style}`);
        await figma.loadFontAsync(styleToApply.fontName);
        node.setRangeFontName(start, end, styleToApply.fontName);
        console.log(`[DEBUG] 🖌️ Font applied: ${styleToApply.fontName.family}`);
      } catch (error) {
        console.log(`[DEBUG] ⚠️ Error applying font: ${error.message}`);
      }
    }
    
    if (styleToApply.fills) {
      try {
        // Ensure fills are in the correct format
        const validFills = styleToApply.fills.map(fill => {
          // Deep clone the fill to avoid reference issues
          const newFill = JSON.parse(JSON.stringify(fill));
          
          // Ensure color values are within valid range (0-1)
          if (newFill.type === 'SOLID' && newFill.color) {
            newFill.color.r = Math.max(0, Math.min(1, newFill.color.r));
            newFill.color.g = Math.max(0, Math.min(1, newFill.color.g));
            newFill.color.b = Math.max(0, Math.min(1, newFill.color.b));
            if (typeof newFill.color.a !== 'undefined') {
              newFill.color.a = Math.max(0, Math.min(1, newFill.color.a));
            } else {
              newFill.color.a = 1; // Default alpha if not specified
            }
          }
          return newFill;
        });
        
        console.log(`[DEBUG] 🖌️ Applying fills:`, JSON.stringify(validFills));
        node.setRangeFills(start, end, validFills);
        console.log(`[DEBUG] 🖌️ Fill applied: ${describeFill(validFills)}`);
      } catch (error) {
        console.log(`[DEBUG] ⚠️ Error applying fill: ${error.message}`, error);
      }
    }
    
    if (styleToApply.fontSize) {
      try {
        node.setRangeFontSize(start, end, styleToApply.fontSize);
        console.log(`[DEBUG] 🖌️ Font size applied: ${styleToApply.fontSize}`);
      } catch (error) {
        console.log(`[DEBUG] ⚠️ Error applying font size: ${error.message}`);
      }
    }
    
    if (styleToApply.textDecoration) {
      try {
        node.setRangeTextDecoration(start, end, styleToApply.textDecoration);
        console.log(`[DEBUG] 🖌️ Text decoration applied: ${styleToApply.textDecoration}`);
      } catch (error) {
        console.log(`[DEBUG] ⚠️ Error applying text decoration: ${error.message}`);
      }
    }
    
    return true;
  } catch (error) {
    console.log(`[DEBUG] ❌ Error in applyStyleToRange: ${error.message}`);
    return false;
  }
}

// Helper function to convert RGB to hex for logging
function rgbToHex(color) {
  if (!color) return 'undefined';
  
  const r = Math.round(color.r * 255);
  const g = Math.round(color.g * 255);
  const b = Math.round(color.b * 255);
  
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

// Helper function to get the parent instance of a node
function getInstanceParent(node) {
  let current = node.parent;
  while (current) {
    if (current.type === "INSTANCE") {
      return current;
    }
    current = current.parent;
  }
  return null;
}

// Language configuration - inlined from language-patterns.js
// Import language patterns configuration
const languageConfig = (function() {
  /**
   * Language-specific patterns and configurations
   * This file centralizes all language-specific text patterns and rules
   * used for translation processing and style mapping.
   */
  
  const languagePatterns = {
    // Hindi language patterns
    hi: {
      // Common patterns for "Reading lists" in Hindi
      readingLists: {
        patterns: [
          "पढ़ने की सूची",
          "पढ़ने की सूचियां",
          "पढ़ने वाली सूची",
          "रीडिंग लिस्ट",
          "पढ़ने की सूचियों"
        ],
        // Fallback word to use when looking for reading lists
        fallbackWord: "पढ़ने",
        // Original text patterns to identify as reading lists
        originalPatterns: ["reading list", "reading lists"]
      },
      // RTL settings for Hindi
      rtl: false,
      // Special text handling for Hindi
      textHandling: {
        // Add any special text handling rules here
      }
    },
    // Add other languages as needed
    ar: {
      rtl: true,
      readingLists: {
        patterns: [
          "قوائم القراءة",
          "قائمة القراءة "
        ],
        originalPatterns: ["reading list", "reading lists"]
      }
    },
    // Example for another language
    fr: {
      rtl: false,
      readingLists: {
        patterns: [
          "Listes de lecture",
          "Liste de lecture"
        ],
        originalPatterns: ["reading list", "reading lists"]
      }
    }
  };
  
  /**
   * Utility function to find reading list patterns in translated text
   * @param {string} translatedText - The translated text to search in
   * @param {string} langCode - The language code (e.g., 'hi', 'ar')
   * @return {Object} Result containing found status, positions, and text
   */
  function findReadingListsInLanguage(translatedText, langCode) {
    // Default return structure
    const result = {
      found: false,
      start: 0,
      end: 0,
      text: ""
    };
    
    // Get language patterns or use empty object if language not supported
    const langConfig = languagePatterns[langCode] || {};
    const readingListsConfig = langConfig.readingLists || { patterns: [] };
    
    if (!translatedText || !readingListsConfig.patterns) {
      console.log(`[DEBUG] 🌍 No patterns defined for language: ${langCode}`);
      return result;
    }
    
    // Try to find any of the patterns
    for (const pattern of readingListsConfig.patterns) {
      const index = translatedText.indexOf(pattern);
      if (index >= 0) {
        result.found = true;
        result.start = index;
        result.end = index + pattern.length;
        result.text = pattern;
        console.log(`[DEBUG] 🌍 Found exact pattern for ${langCode}: "${pattern}" at position ${index}`);
        return result;
      }
    }
    
    // Fallback: if none of the exact patterns match but fallback word exists
    if (readingListsConfig.fallbackWord) {
      const fallbackWord = readingListsConfig.fallbackWord;
      const index = translatedText.indexOf(fallbackWord);
      
      if (index >= 0) {
        // Find a reasonable end by looking for the next space or a few characters
        let end = translatedText.indexOf(" ", index + fallbackWord.length);
        if (end < 0) end = Math.min(index + 20, translatedText.length);
        
        result.found = true;
        result.start = index;
        result.end = end;
        result.text = translatedText.substring(index, end);
        console.log(`[DEBUG] 🌍 Found fallback word for ${langCode} and expanded to: "${result.text}"`);
        return result;
      }
    }
    
    // Final fallback: If we still haven't found anything but translation exists
    if (translatedText && translatedText.length > 0) {
      // Last resort: just use the first two words of the translation
      const words = translatedText.split(' ');
      if (words.length >= 2) {
        const firstTwoWords = words.slice(0, 2).join(' ');
        result.found = true;
        result.start = 0;
        result.end = firstTwoWords.length;
        result.text = firstTwoWords;
        console.log(`[DEBUG] 🌍 Using first two words as fallback for ${langCode}: "${result.text}"`);
      }
    }
    
    console.log(`[DEBUG] 🌍 findReadingListsInLanguage result for ${langCode}:`, result);
    return result;
  }
  
  /**
   * Check if the text contains a reading list pattern in the original language
   * @param {string} text - The original text to check
   * @param {string} langCode - The language code
   * @return {boolean} True if text contains a reading list pattern
   */
  function hasReadingListPattern(text, langCode) {
    if (!text) return false;
    
    const langConfig = languagePatterns[langCode] || {};
    const readingListsConfig = langConfig.readingLists || {};
    const patterns = readingListsConfig.originalPatterns || [];
    
    // Check if the text contains any of the patterns (case insensitive)
    const lowerText = text.toLowerCase();
    return patterns.some(pattern => lowerText.includes(pattern.toLowerCase()));
  }
  
  /**
   * Check if a language is RTL
   * @param {string} langCode - The language code
   * @return {boolean} True if the language is RTL
   */
  function isRTLLanguage(langCode) {
    const langConfig = languagePatterns[langCode] || {};
    return !!langConfig.rtl;
  }
  
  return {
    languagePatterns,
    findReadingListsInLanguage,
    hasReadingListPattern,
    isRTLLanguage
  };
})();

// Helper function to find the equivalent of "Reading lists" in translated text
function findReadingListsInTranslation(translatedText, targetLang) {
  return languageConfig.findReadingListsInLanguage(translatedText, targetLang);
}

// Special handler for translations with "Reading lists" patterns
async function handleSpecialTextPatterns(node, translatedText, originalText, styleRanges, targetLang) {
  console.log(`[DEBUG] 🌍 Handling special patterns for ${targetLang} translation`);
  
  try {
    // Safety checks for inputs
    if (!node || !translatedText || !originalText || !styleRanges) {
      console.log(`[DEBUG] ❌ Missing required parameters in handleSpecialTextPatterns`);
      return false;
    }
    
    // Check if this is a text with "Reading lists" or similar special pattern
    if (!languageConfig.hasReadingListPattern(originalText, targetLang)) {
      console.log(`[DEBUG] 🌍 Text does not contain special patterns for ${targetLang}, skipping special handling`);
      return false;
    }
    
    console.log(`[DEBUG] 🌍 Processing ${targetLang} translation with special pattern`);
    console.log(`[DEBUG] 🌍 Original: "${originalText}"`);
    console.log(`[DEBUG] 🌍 Translated: "${translatedText}"`);
    
    // Find the special blue style range used for "Reading lists"
    const specialStyleRange = styleRanges.find(r => 
      r && r.style && r.style.fills && 
      r.style.fills.some(fill => 
        fill && fill.type === 'SOLID' && 
        fill.color && 
        fill.color.b > 0.6 && 
        fill.color.r < 0.3
      ) &&
      r.text && languageConfig.hasReadingListPattern(r.text, targetLang)
    );
    
    if (!specialStyleRange) {
      console.log(`[DEBUG] 🌍 Could not find special style for pattern in ${targetLang}, falling back to normal handling`);
      return false;
    }
    
    console.log(`[DEBUG] 🌍 Found special style for pattern: "${specialStyleRange.text}"`);
    
    // Find the equivalent for the pattern in the target language
    const translationInfo = findReadingListsInTranslation(translatedText, targetLang);
    
    if (!translationInfo || !translationInfo.found) {
      console.log(`[DEBUG] 🌍 Could not find equivalent for pattern in ${targetLang}, falling back`);
      return false;
    }
    
    console.log(`[DEBUG] 🌍 Found equivalent in ${targetLang} at positions ${translationInfo.start}-${translationInfo.end}: "${translationInfo.text}"`);
    
    // Apply the base style to the entire text first
    const defaultStyle = getDefaultStyle(styleRanges, node);
    
    if (defaultStyle) {
      console.log(`[DEBUG] 🌍 Applying default style to entire text`);
      await applyStyleToRange(node, 0, translatedText.length, defaultStyle);
    }
    
    // Apply the special style to the equivalent text in the target language
    console.log(`[DEBUG] 🌍 Applying special style to phrase: "${translationInfo.text}"`);
    const success = await applyStyleToRange(node, translationInfo.start, translationInfo.end, specialStyleRange.style);
    
    if (success) {
      console.log(`[DEBUG] 🌍 Successfully applied style to phrase in ${targetLang}`);
      return true;
    } else {
      console.log(`[DEBUG] ❌ Failed to apply style to phrase in ${targetLang}, falling back to normal handling`);
      return false;
    }
  } catch (error) {
    console.log(`[DEBUG] ❌ Error in handleSpecialTextPatterns: ${error.message}`);
    return false;
  }
}