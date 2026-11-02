import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/fonts.css';
import './styles/tokens.css';
import './styles/base.css';
import './styles/shell.css';
import './styles/plate.css';
import './styles/home.css';
import './styles/scan.css';
import './styles/workspace.css';
import './styles/pages.css';
import './styles/train.css';
import { App } from './App';
import { applyToDocument, useSettings } from './lib/settings';

applyToDocument(useSettings.getState());

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
