import React, { useState } from 'react';
import { useAppStore } from '../../stores/appStore';
import { TIMEZONES } from '../../../shared/types';
import './ValidationModal.css';

function ValidationModal() {
  const {
    showValidationModal,
    closeValidationModal,
    updateSettings,
    resetAllPolls,
    addNotification,
    getCurrentProfile,
  } = useAppStore();

  const currentProfile = getCurrentProfile();

  const [timezone, setTimezone] = useState(currentProfile.settings.timezone);
  const [windowPattern, setWindowPattern] = useState(currentProfile.settings.windowTarget.pattern);
  const [matchMode, setMatchMode] = useState(currentProfile.settings.windowTarget.matchMode);
  const [shouldResetPolls, setShouldResetPolls] = useState(false);

  if (!showValidationModal) return null;

  const handleConfirm = () => {
    // Update settings
    updateSettings({
      timezone,
      windowTarget: {
        ...currentProfile.settings.windowTarget,
        matchMode,
        pattern: windowPattern,
      },
    });

    // Reset polls if selected
    if (shouldResetPolls) {
      resetAllPolls();
      addNotification('All polls have been reset', 'success');
    }

    closeValidationModal();
    addNotification('Settings confirmed', 'success');
  };

  return (
    <div className="validation-modal-overlay">
      <div className="validation-modal">
        <div className="validation-modal-header">
          <span className="validation-modal-title">WELCOME BACK!</span>
        </div>
        <p className="validation-modal-subtitle">
          It's been a while! Please verify your settings.
        </p>

        <div className="validation-modal-content">
          <div className="validation-field">
            <label className="validation-label">TIMEZONE</label>
            <select
              className="select"
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
            >
              {TIMEZONES.map((tz) => (
                <option key={tz} value={tz}>
                  {tz.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
          </div>

          <div className="validation-field">
            <label className="validation-label">WINDOW TARGET PATTERN</label>
            <input
              type="text"
              className="input"
              value={windowPattern}
              onChange={(e) => setWindowPattern(e.target.value)}
              placeholder="e.g., Slack"
            />
          </div>

          <div className="validation-field">
            <label className="validation-label">MATCH MODE</label>
            <select
              className="select"
              value={matchMode}
              onChange={(e) => setMatchMode(e.target.value as 'exact' | 'contains' | 'regex')}
            >
              <option value="contains">Contains</option>
              <option value="exact">Exact</option>
              <option value="regex">Regex</option>
            </select>
          </div>

          <label className="validation-checkbox">
            <input
              type="checkbox"
              checked={shouldResetPolls}
              onChange={(e) => setShouldResetPolls(e.target.checked)}
            />
            <span>Reset all polls (mark as unsent)</span>
          </label>
        </div>

        <div className="validation-modal-actions">
          <button className="btn btn--success" onClick={handleConfirm}>
            CONFIRM
          </button>
        </div>
      </div>
    </div>
  );
}

export default ValidationModal;
