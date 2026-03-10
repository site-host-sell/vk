import React from 'react';
import ReactDOM from 'react-dom/client';
import bridge from '@vkontakte/vk-bridge';
import { App } from './App';
import '@vkontakte/vkui/dist/vkui.css';
import './app.css';

bridge.send('VKWebAppInit').catch(() => {
  // Non-VK browser local mode.
});

ReactDOM.createRoot(document.getElementById('app') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
