
import './utils/authFetch';
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);

// PWA: register the service worker so MES is installable on phones ("Add to
// Home Screen") and the app shell opens on a flaky factory network.
// Only in production builds and only over HTTPS/localhost.
if (process.env.NODE_ENV === 'production' && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/service-worker.js').catch((err) => {
      console.warn('Service worker registration failed:', err);
    });
  });
}
