import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './index.css';

// Self-hosted variable fonts (replace the Google Fonts CDN link). Variable
// fonts ship the entire weight axis as a single file, so this covers
// Inter 400/500/600/700/800 and JetBrains Mono 400/500/600 with two
// bundled woff2s — no network dependency, works offline in the Capacitor
// build, no CDN exfiltration on first paint.
import '@fontsource-variable/inter';
import '@fontsource-variable/jetbrains-mono';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
