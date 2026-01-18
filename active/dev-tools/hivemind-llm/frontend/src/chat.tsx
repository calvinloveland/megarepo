import React from 'react';
import ReactDOM from 'react-dom/client';
import { Buffer } from 'buffer';
import process from 'process';
import './index.css';

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Missing #root element for chat app');
}

(globalThis as typeof globalThis & { global?: typeof globalThis }).global = globalThis;
(globalThis as typeof globalThis & { Buffer?: typeof Buffer }).Buffer = Buffer;
(globalThis as typeof globalThis & { process?: typeof process }).process = process;

const renderApp = async () => {
  const { default: App } = await import('./App');
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
};

renderApp().catch((error) => {
  console.error('Failed to start chat app:', error);
  rootElement.textContent = 'Failed to start chat app. Check the console for details.';
});
