import React, { useState } from 'react';
import { useAppStore } from '../../stores/appStore';
import './Notifications.css';

function Notifications() {
  const { notifications, removeNotification } = useAppStore();
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const handleCopyError = async (e: React.MouseEvent, id: string, message: string) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(message);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 1500);
    } catch {
      // Silently fail if clipboard access is denied
    }
  };

  return (
    <div className="notifications">
      {notifications.map((notification) => (
        <div
          key={notification.id}
          className={`notification notification--${notification.type}`}
          onClick={() => removeNotification(notification.id)}
        >
          <span className="notification-icon">
            {notification.type === 'success' && '✓'}
            {notification.type === 'error' && '✕'}
            {notification.type === 'info' && 'ℹ'}
          </span>
          <span className="notification-message">{notification.message}</span>
          {notification.action && (
            <button
              className="notification-action-btn"
              onClick={(e) => {
                e.stopPropagation();
                notification.action!.onClick();
                removeNotification(notification.id);
              }}
            >
              {notification.action.label}
            </button>
          )}
          {notification.type === 'error' && (
            <button
              className="notification-copy-btn"
              onClick={(e) => handleCopyError(e, notification.id, notification.message)}
              title="Copy error message"
            >
              {copiedId === notification.id ? '✓' : '⧉'}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

export default Notifications;
