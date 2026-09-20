import React, { useEffect } from 'react';
import { useAppStore } from './stores/appStore';
import { FONT_SIZE_PRESETS_RETRO, FONT_SIZE_PRESETS_MODERN } from '../shared/types';
import Layout from './components/Layout/Layout';
import Notifications from './components/common/Notifications';
import SettingsModal from './components/Settings/SettingsModal';
import ValidationModal from './components/common/ValidationModal';
import './App.css';

function App() {
  const { loadConfig, isLoading, isBreakAlertActive, getCurrentProfile } = useAppStore();
  const currentProfile = getCurrentProfile();

  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  // Apply theme CSS variables
  useEffect(() => {
    // Use break alert theme if active, otherwise use normal theme
    const theme = isBreakAlertActive && currentProfile.settings.breakAlertTheme
      ? currentProfile.settings.breakAlertTheme
      : currentProfile.settings.theme;
    const root = document.documentElement;

    root.style.setProperty('--color-primary', theme.colors.primary);
    root.style.setProperty('--color-secondary', theme.colors.secondary);
    root.style.setProperty('--color-background', theme.colors.background);
    root.style.setProperty('--color-surface', theme.colors.surface);
    root.style.setProperty('--color-text', theme.colors.text);
    root.style.setProperty('--color-text-muted', theme.colors.textMuted);
    root.style.setProperty('--color-accent', theme.colors.accent);
    root.style.setProperty('--color-border', theme.colors.border);
    root.style.setProperty('--color-danger', theme.colors.danger);
    root.style.setProperty('--color-success', theme.colors.success);
    root.style.setProperty('--font-family', theme.fontFamily);

    // Apply modern font smoothing for non-retro fonts
    const isModernFont = theme.fontFamily.includes('Lexend') ||
                         theme.fontFamily === 'sans-serif' ||
                         theme.fontFamily.includes('Courier');
    document.body.style.setProperty('-webkit-font-smoothing', isModernFont ? 'antialiased' : 'none');
    document.body.style.setProperty('-moz-osx-font-smoothing', isModernFont ? 'grayscale' : 'unset');

    // Set data attribute for modern font styling in CSS
    root.dataset.fontStyle = isModernFont ? 'modern' : 'retro';

    // Apply font size - use larger sizes for modern fonts
    const fontSize = currentProfile.settings.fontSize || 'medium';
    const sizePresets = isModernFont ? FONT_SIZE_PRESETS_MODERN : FONT_SIZE_PRESETS_RETRO;
    const sizes = sizePresets[fontSize];
    root.style.setProperty('--font-size-xs', `${sizes.xs}px`);
    root.style.setProperty('--font-size-sm', `${sizes.sm}px`);
    root.style.setProperty('--font-size-base', `${sizes.base}px`);
    root.style.setProperty('--font-size-lg', `${sizes.lg}px`);
  }, [currentProfile.settings.theme, currentProfile.settings.breakAlertTheme, currentProfile.settings.fontSize, isBreakAlertActive]);

  if (isLoading) {
    return (
      <div className="loading-screen">
        <div className="loading-brand">GIMBAL</div>
        <div className="loading-tagline">Stay the Course</div>
        <div className="loading-text">LOADING...</div>
        <div className="loading-bar">
          <div className="loading-bar-fill"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <Layout />
      <Notifications />
      <SettingsModal />
      <ValidationModal />
    </div>
  );
}

export default App;
