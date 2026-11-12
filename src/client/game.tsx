import './index.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { TimelineGame } from './timeline/TimelineGame';

const root = document.getElementById('root');
if (!root) throw new Error('Root element missing');

createRoot(root).render(
  <StrictMode>
    <TimelineGame />
  </StrictMode>
);
