# Figma I18n Text Preview

A simple Figma plugin to preview how your text will look in different languages.

## What it does

- Shows your text in different languages (English, Spanish, French, German, Japanese, Chinese, Arabic)
- Lets you quickly switch between languages
- Saves the original text so you can always go back
- Supports right-to-left languages (like Arabic)

## How to use

1. Select any text in Figma
2. Run the plugin
3. Pick a language from the dropdown
4. Click "Apply Translation" to see the change
5. Click "Reset" to go back to the original text

## Setup for development

```bash
npm install
npm run build
```

Then in Figma:
- Go to Plugins
- Click "Development"
- Choose "Import plugin from manifest"
- Select the manifest.json from this folder