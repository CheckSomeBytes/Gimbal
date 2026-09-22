import React, { useState, DragEvent } from 'react';
import { Link, AdditionalUrl } from '../../../shared/types';
import { useAppStore } from '../../stores/appStore';
import { useOverlayDismiss } from '../../hooks/useOverlayDismiss';
import iconBrowser from '../../assets/icon-browser.png';
import iconSlack from '../../assets/icon-slack.png';
import iconClipboard from '../../assets/icon-clipboard.png';
import './LinkItem.css';

interface LinkItemProps {
  dayId: string;
  sectionId: string;
  link: Link;
}

function LinkItem({ dayId, sectionId, link }: LinkItemProps) {
  const { updateLink, deleteLink, addNotification, isEditMode, selectedItemIds, toggleItemSelection, getCurrentProfile } = useAppStore();
  const currentProfile = getCurrentProfile();
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(link.customTitle || link.title);
  const [editUrl, setEditUrl] = useState(link.url);

  // Multi-link edit state
  const [editGroupTitle, setEditGroupTitle] = useState(link.customTitle || link.title);
  const [editEntries, setEditEntries] = useState<AdditionalUrl[]>(
    link.additionalUrls || [{ url: link.url, title: link.customTitle || link.title }]
  );

  const isMultiUrl = link.additionalUrls && link.additionalUrls.length > 0;
  const displayTitle = link.customTitle || link.title;
  const [isCollapsed, setIsCollapsed] = useState(true);

  const handleSave = () => {
    if (isMultiUrl) {
      const validEntries = editEntries.filter(e => e.url.trim());
      if (editGroupTitle.trim() && validEntries.length > 0) {
        updateLink(dayId, sectionId, link.id, {
          customTitle: editGroupTitle.trim(),
          url: validEntries[0].url.trim(),
          additionalUrls: validEntries.map(e => ({ url: e.url.trim(), title: e.title.trim() || e.url.trim() })),
        });
        setIsEditing(false);
      }
    } else {
      if (editTitle.trim() && editUrl.trim()) {
        updateLink(dayId, sectionId, link.id, {
          customTitle: editTitle.trim(),
          url: editUrl.trim(),
          additionalUrls: undefined,
        });
        setIsEditing(false);
      }
    }
  };

  const handleCancelEdit = () => {
    setIsEditing(false);
    setEditTitle(link.customTitle || link.title);
    setEditUrl(link.url);
    setEditGroupTitle(link.customTitle || link.title);
    setEditEntries(link.additionalUrls || [{ url: link.url, title: link.customTitle || link.title }]);
  };

  const overlayDismiss = useOverlayDismiss(handleCancelEdit);

  const handleOpenInChrome = async (url: string) => {
    try {
      await window.electronAPI.openInChrome(url);
    } catch (error) {
      addNotification('Failed to open link in Chrome', 'error');
    }
  };

  const handleFocusAndPaste = async (url: string, title: string) => {
    const { windowTarget } = currentProfile.settings;

    if (!windowTarget.pattern) {
      addNotification('No window pattern configured. Go to Settings.', 'error');
      return;
    }

    const textToPaste = `${title}\n${url}`;
    const result = await window.electronAPI.focusAndPaste(
      windowTarget.pattern,
      windowTarget.matchMode,
      textToPaste,
      windowTarget.pressEnterAfterPaste
    );

    if (!result.success) {
      addNotification(result.error || 'Failed to paste link', 'error');
    }
  };

  const handleCopy = async (url: string, title: string) => {
    try {
      const textToCopy = `${title}\n${url}`;
      await navigator.clipboard.writeText(textToCopy);
      addNotification('Link copied to clipboard', 'success');
    } catch {
      addNotification('Failed to copy link', 'error');
    }
  };

  // Group actions for multi-URL
  const handleOpenAll = async () => {
    if (!link.additionalUrls) return;
    for (const entry of link.additionalUrls) {
      await handleOpenInChrome(entry.url);
    }
  };

  const handleSendAll = async () => {
    if (!link.additionalUrls) return;
    for (const entry of link.additionalUrls) {
      await handleFocusAndPaste(entry.url, entry.title);
    }
  };

  const handleCopyAll = async () => {
    if (!link.additionalUrls) return;
    try {
      const text = link.additionalUrls.map(entry => `${entry.title}\n${entry.url}`).join('\n\n');
      await navigator.clipboard.writeText(text);
      addNotification('All links copied to clipboard', 'success');
    } catch {
      addNotification('Failed to copy links', 'error');
    }
  };

  const getStatusIcon = (status?: string, useParentFallback = true) => {
    const s = useParentFallback ? (status || link.status) : status;
    switch (s) {
      case 'ok':
        return <span className="link-status link-status--ok" title="Link OK">✓</span>;
      case 'broken':
        return <span className="link-status link-status--broken" title="Link broken">⚠</span>;
      case 'timeout':
        return <span className="link-status link-status--timeout" title="Link timed out">⏱</span>;
      case 'unchecked':
        return <span className="link-status link-status--unchecked" title="Unable to verify (protected site)">?</span>;
      case 'pending':
        return <span className="link-status link-status--pending" title="Checking...">⋯</span>;
      default:
        return null;
    }
  };

  // For multi-link, check if any URL has issues
  const getMultiLinkStatusIcon = () => {
    if (!link.additionalUrls) return getStatusIcon();

    const statuses = link.additionalUrls.map(a => a.status);
    const hasBroken = statuses.includes('broken');
    const hasTimeout = statuses.includes('timeout');
    const hasUnchecked = statuses.includes('unchecked');
    const hasPending = statuses.includes('pending');
    const allOk = statuses.length > 0 && statuses.every(s => s === 'ok');

    // Show broken/timeout immediately if any link fails
    if (hasBroken) {
      return <span className="link-status link-status--broken" title="One or more links broken">⚠</span>;
    }
    if (hasTimeout) {
      return <span className="link-status link-status--timeout" title="One or more links timed out">⏱</span>;
    }
    // Show pending if any links still being checked (even if some are ok)
    if (hasPending) {
      return <span className="link-status link-status--pending" title="Checking links...">⋯</span>;
    }
    // Only show all OK when every link is verified OK
    if (allOk) {
      return <span className="link-status link-status--ok" title="All links OK">✓</span>;
    }
    if (hasUnchecked) {
      return <span className="link-status link-status--unchecked" title="One or more links unable to verify">?</span>;
    }
    // Show unchecked if no status set yet
    return <span className="link-status link-status--unchecked" title="Not checked">?</span>;
  };

  const isSelected = selectedItemIds.has(link.id);
  const [isDragging, setIsDragging] = useState(false);

  const handleDragStart = (e: DragEvent<HTMLDivElement>) => {
    e.dataTransfer.setData('application/json', JSON.stringify({
      itemId: link.id,
      sourceDayId: dayId,
      sourceSectionId: sectionId,
    }));
    e.dataTransfer.effectAllowed = 'move';
    setIsDragging(true);
  };

  const handleDragEnd = () => {
    setIsDragging(false);
  };

  const updateEditEntry = (index: number, field: 'url' | 'title', value: string) => {
    setEditEntries(prev => prev.map((e, i) => i === index ? { ...e, [field]: value } : e));
  };

  const addEditEntry = () => {
    setEditEntries(prev => [...prev, { url: '', title: '' }]);
  };

  const removeEditEntry = (index: number) => {
    if (editEntries.length <= 1) return;
    setEditEntries(prev => prev.filter((_, i) => i !== index));
  };

  if (isEditing) {
    return (
      <div className="edit-item-overlay" {...overlayDismiss}>
      <div className="add-item-form" onClick={(e) => e.stopPropagation()}>
        {isMultiUrl ? (
          <div className="add-item-fields">
            <input
              type="text"
              className="input"
              placeholder="Group title..."
              value={editGroupTitle}
              onChange={(e) => setEditGroupTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') handleCancelEdit();
              }}
              autoFocus
            />
            <div className="multi-link-entries">
              {editEntries.map((entry, index) => (
                <div className="multi-link-entry" key={index}>
                  <div className="multi-link-entry-fields">
                    <input
                      type="text"
                      className="input"
                      placeholder="URL..."
                      value={entry.url}
                      onChange={(e) => updateEditEntry(index, 'url', e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Escape') handleCancelEdit();
                      }}
                    />
                    <input
                      type="text"
                      className="input"
                      placeholder="Title..."
                      value={entry.title}
                      onChange={(e) => updateEditEntry(index, 'title', e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Escape') handleCancelEdit();
                      }}
                    />
                  </div>
                  {editEntries.length > 1 && (
                    <button
                      className="btn btn--small btn--danger multi-link-remove-btn"
                      onClick={() => removeEditEntry(index)}
                      title="Remove"
                    >
                      ✕
                    </button>
                  )}
                </div>
              ))}
            </div>
            <button
              className="btn btn--small btn--secondary"
              onClick={addEditEntry}
            >
              + ADD URL
            </button>
          </div>
        ) : (
          <div className="add-item-fields">
            <input
              type="text"
              className="input"
              placeholder="URL..."
              value={editUrl}
              onChange={(e) => setEditUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSave();
                if (e.key === 'Escape') handleCancelEdit();
              }}
              autoFocus
            />
            <input
              type="text"
              className="input"
              placeholder="Title..."
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSave();
                if (e.key === 'Escape') handleCancelEdit();
              }}
            />
          </div>
        )}
        <div className="add-item-actions">
          <button className="btn btn--small btn--success" onClick={handleSave}>
            SAVE
          </button>
          <button className="btn btn--small btn--secondary" onClick={handleCancelEdit}>
            CANCEL
          </button>
        </div>
      </div>
      </div>
    );
  }

  // Single URL - render exactly as before
  if (!isMultiUrl) {
    return (
      <div
        className={`link-item ${isSelected ? 'link-item--selected' : ''} ${isDragging ? 'link-item--dragging' : ''}`}
        draggable={isEditMode}
        onDragStart={isEditMode ? handleDragStart : undefined}
        onDragEnd={isEditMode ? handleDragEnd : undefined}
      >
        {isEditMode && (
          <input
            type="checkbox"
            className="item-checkbox"
            checked={isSelected}
            onChange={() => toggleItemSelection(link.id)}
          />
        )}
        <div className="link-info">
          <span className="link-icon">🔗</span>
          <span
            className="link-title truncate"
            title={`${displayTitle}\n${link.url}`}
          >
            {displayTitle}
          </span>
          {getStatusIcon()}
        </div>

        <div className="link-actions">
          <button
            className="link-action-btn"
            onClick={() => handleOpenInChrome(link.url)}
            title="Open in Chrome"
          >
            <img src={iconBrowser} alt="Open in Chrome" className="link-action-icon" />
          </button>
          <button
            className="link-action-btn"
            onClick={() => handleFocusAndPaste(link.url, displayTitle)}
            title="Focus window and paste"
          >
            <img src={iconSlack} alt="Focus & Paste" className="link-action-icon" />
          </button>
          <button
            className="link-action-btn"
            onClick={() => handleCopy(link.url, displayTitle)}
            title="Copy to clipboard"
          >
            <img src={iconClipboard} alt="Copy" className="link-action-icon" />
          </button>
          {isEditMode && (
            <>
              <button
                className="link-action-btn"
                onClick={() => setIsEditing(true)}
                title="Edit"
              >
                <span className="link-action-text">✎</span>
              </button>
              <button
                className="link-action-btn link-action-btn--delete"
                onClick={() => {
                  if (confirm(`Delete "${displayTitle}"?`)) {
                    deleteLink(dayId, sectionId, link.id);
                  }
                }}
                title="Delete"
              >
                <span className="link-action-text">✕</span>
              </button>
            </>
          )}
        </div>
      </div>
    );
  }

  // Multi-URL layout
  return (
    <div
      className={`link-item-multi ${isSelected ? 'link-item--selected' : ''} ${isDragging ? 'link-item--dragging' : ''}`}
      draggable={isEditMode}
      onDragStart={isEditMode ? handleDragStart : undefined}
      onDragEnd={isEditMode ? handleDragEnd : undefined}
    >
      {/* Title row with group actions */}
      <div className="link-item-multi-header">
        {isEditMode && (
          <input
            type="checkbox"
            className="item-checkbox"
            checked={isSelected}
            onChange={() => toggleItemSelection(link.id)}
          />
        )}
        <button
          className="link-collapse-btn"
          onClick={() => setIsCollapsed(!isCollapsed)}
          title={isCollapsed ? 'Expand' : 'Collapse'}
        >
          {isCollapsed ? '▶' : '▼'}
        </button>
        <div className="link-info">
          <span className="link-icon">🔗</span>
          <span
            className="link-title link-group-title truncate"
            title={displayTitle}
          >
            {displayTitle}
          </span>
          {getMultiLinkStatusIcon()}
        </div>

        <div className="link-actions">
          <button
            className="link-action-btn"
            onClick={handleOpenAll}
            title="Open all in Chrome"
          >
            <img src={iconBrowser} alt="Open All" className="link-action-icon link-action-icon--small" />
          </button>
          <button
            className="link-action-btn"
            onClick={handleSendAll}
            title="Send all to window"
          >
            <img src={iconSlack} alt="Send All" className="link-action-icon link-action-icon--small" />
          </button>
          <button
            className="link-action-btn"
            onClick={handleCopyAll}
            title="Copy all to clipboard"
          >
            <img src={iconClipboard} alt="Copy All" className="link-action-icon link-action-icon--small" />
          </button>
          {isEditMode && (
            <>
              <button
                className="link-action-btn"
                onClick={() => setIsEditing(true)}
                title="Edit"
              >
                <span className="link-action-text">✎</span>
              </button>
              <button
                className="link-action-btn link-action-btn--delete"
                onClick={() => {
                  if (confirm(`Delete "${displayTitle}"?`)) {
                    deleteLink(dayId, sectionId, link.id);
                  }
                }}
                title="Delete"
              >
                <span className="link-action-text">✕</span>
              </button>
            </>
          )}
        </div>
      </div>

      {/* Individual URL rows */}
      {!isCollapsed && (
        <div className="link-url-list">
          {link.additionalUrls!.map((entry, index) => (
            <div className="link-url-row" key={index}>
              <div className="link-url-info">
                <span className="link-url-text truncate" title={`${entry.title}\n${entry.url}`}>
                  {entry.title}
                </span>
                {getStatusIcon(entry.status, false)}
              </div>
              <div className="link-actions">
                <button
                  className="link-action-btn"
                  onClick={() => handleOpenInChrome(entry.url)}
                  title="Open in Chrome"
                >
                  <img src={iconBrowser} alt="Open" className="link-action-icon link-action-icon--small" />
                </button>
                <button
                  className="link-action-btn"
                  onClick={() => handleFocusAndPaste(entry.url, entry.title)}
                  title="Focus window and paste"
                >
                  <img src={iconSlack} alt="Send" className="link-action-icon link-action-icon--small" />
                </button>
                <button
                  className="link-action-btn"
                onClick={() => handleCopy(entry.url, entry.title)}
                  title="Copy to clipboard"
                >
                  <img src={iconClipboard} alt="Copy" className="link-action-icon link-action-icon--small" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default LinkItem;
