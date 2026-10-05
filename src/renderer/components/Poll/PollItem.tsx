import React, { useState } from 'react';
import { Poll } from '../../../shared/types';
import { useAppStore } from '../../stores/appStore';
import iconSlack from '../../assets/icon-slack.png';
import iconClipboard from '../../assets/icon-clipboard.png';
import './PollItem.css';

interface PollItemProps {
  dayId: string;
  sectionId: string;
  poll: Poll;
}

function PollItem({ dayId, sectionId, poll }: PollItemProps) {
  const { updatePoll, deletePoll, markPollSent, resetPoll, addNotification, sendToTargetWindow, automationSupported, isEditMode, getCurrentProfile } = useAppStore();
  const currentProfile = getCurrentProfile();
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(poll.title);
  const [editContent, setEditContent] = useState(poll.content);
  const [isExpanded, setIsExpanded] = useState(false);

  const handleSave = () => {
    if (editTitle.trim() && editContent.trim()) {
      updatePoll(dayId, sectionId, poll.id, {
        title: editTitle.trim(),
        content: editContent.trim(),
      });
      setIsEditing(false);
    }
  };

  const handleCancelEdit = () => {
    setIsEditing(false);
    setEditTitle(poll.title);
    setEditContent(poll.content);
  };

  const handleFocusAndPaste = async () => {
    const result = await sendToTargetWindow(
      poll.content,
      currentProfile.settings.windowTarget.pressEnterAfterPaste
    );

    if (result.success) {
      markPollSent(dayId, sectionId, poll.id);
    } else {
      addNotification(result.error || 'Failed to paste poll', 'error');
    }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(poll.content);
      addNotification('Poll copied to clipboard', 'success');
    } catch {
      addNotification('Failed to copy poll', 'error');
    }
  };

  const handleReset = () => {
    resetPoll(dayId, sectionId, poll.id);
  };

  if (isEditing) {
    return (
      <div className="add-item-form">
        <div className="add-item-fields">
          <input
            type="text"
            className="input"
            placeholder="Poll title..."
            value={editTitle}
            onChange={(e) => setEditTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') handleCancelEdit();
            }}
            autoFocus
          />
          <textarea
            className="textarea"
            placeholder="Poll content..."
            value={editContent}
            onChange={(e) => setEditContent(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') handleCancelEdit();
            }}
          />
        </div>
        <div className="add-item-actions">
          <button className="btn btn--small btn--success" onClick={handleSave}>
            SAVE
          </button>
          <button className="btn btn--small btn--secondary" onClick={handleCancelEdit}>
            CANCEL
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={`poll-item ${poll.sent ? 'poll-item--sent' : ''}`}>
      <div className="poll-info">
        <span className="poll-icon">📊</span>
        <span
          className={`poll-title truncate ${poll.sent ? 'poll-title--sent' : ''}`}
          onClick={() => setIsExpanded(!isExpanded)}
          title="Click to expand"
        >
          {poll.title}
        </span>
        {poll.sent && <span className="poll-sent-badge">SENT</span>}
      </div>

      {isExpanded && (
        <div className="poll-content-preview">{poll.content}</div>
      )}

      <div className="poll-actions">
        <button
          className="poll-action-btn"
          onClick={handleFocusAndPaste}
          title={automationSupported ? 'Focus window and paste' : 'Copy to clipboard (auto-paste isn\'t available on this platform)'}
        >
          <img src={iconSlack} alt="Focus & Paste" className="poll-action-icon" />
        </button>
        <button
          className="poll-action-btn"
          onClick={handleCopy}
          title="Copy to clipboard"
        >
          <img src={iconClipboard} alt="Copy" className="poll-action-icon" />
        </button>
        {poll.sent && (
          <button
            className="poll-action-btn"
            onClick={handleReset}
            title="Reset to new"
          >
            <span className="poll-action-text">↺</span>
          </button>
        )}
        {isEditMode && (
          <>
            <button
              className="poll-action-btn"
              onClick={() => setIsEditing(true)}
              title="Edit"
            >
              <span className="poll-action-text">✎</span>
            </button>
            <button
              className="poll-action-btn poll-action-btn--delete"
              onClick={() => {
                if (confirm(`Delete poll "${poll.title}"?`)) {
                  deletePoll(dayId, sectionId, poll.id);
                }
              }}
              title="Delete"
            >
              <span className="poll-action-text">✕</span>
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export default PollItem;
