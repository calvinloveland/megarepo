import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

// Debug: Log that we're starting
console.log('[HiveMind] Starting React app...');

const rootElement = document.getElementById('root');

if (!rootElement) {
  console.error('[HiveMind] Root element not found!');
  document.body.innerHTML = '<div style="color: red; padding: 20px;">Error: Root element not found</div>';
} else {
  try {
    console.log('[HiveMind] Creating React root...');
    const root = ReactDOM.createRoot(rootElement);
    
    console.log('[HiveMind] Rendering App...');
    root.render(
      <React.StrictMode>
        <App />
      </React.StrictMode>,
    );
    console.log('[HiveMind] Render called successfully');
  } catch (error) {
    console.error('[HiveMind] Error rendering app:', error);
    document.body.innerHTML = `<div style="color: red; padding: 20px;">
      <h1>React Error</h1>
      <pre>${error}</pre>
    </div>`;
  }
}
