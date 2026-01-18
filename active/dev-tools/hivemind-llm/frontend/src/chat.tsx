import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Missing #root element for chat app');
}

(globalThis as typeof globalThis & { global?: typeof globalThis }).global = globalThis;

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
