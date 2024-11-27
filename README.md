# Figma I18n Text Preview

A Figma plugin for previewing text in different languages using Claude API.

## Setup

1. Clone this repository
2. Navigate to the proxy-server directory
3. Install dependencies:
   ```bash
   cd proxy-server
   npm install
   ```
4. Add your Claude API key in `server.js`
5. Start the proxy server:
   ```bash
   npm start
   ```
6. In Figma desktop app:
   - Go to Plugins menu
   - Select Development > Import plugin from manifest
   - Choose the manifest.json from this repository

## Usage

1. Select a frame in Figma
2. Run the plugin
3. Choose target language
4. Click 'Run Translation Test'
5. Wait for the translation to complete

## Architecture

- The Figma plugin communicates with a local proxy server
- The proxy server handles Claude API calls
- This setup avoids CORS issues while keeping the API key secure

## Development

- The plugin code is in `code.js` and `ui.html`
- Proxy server code is in `proxy-server/server.js`
- Modify the port in `server.js` if needed