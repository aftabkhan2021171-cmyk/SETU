import './lib/uuid';
import { createRoot } from 'react-dom/client';
import './styles.css';
import App from './App';
import { registerSW } from 'virtual:pwa-register';

// Register PWA service worker immediately for 100% offline access
registerSW({ immediate: true });

createRoot(document.getElementById('root')!).render(<App />);
