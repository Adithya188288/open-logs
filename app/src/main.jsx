import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.jsx';
import './styles/app.css';
import './styles/pages.css';
import './styles/tail.css';
import './styles/dashboard.css';

createRoot(/** @type {HTMLElement} */ (document.getElementById('root'))).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
