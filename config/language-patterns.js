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
        "قائمة القراءة"
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

module.exports = {
  languagePatterns,
  findReadingListsInLanguage,
  hasReadingListPattern,
  isRTLLanguage
}; 