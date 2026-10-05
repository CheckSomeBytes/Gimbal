import React, { useState, DragEvent } from 'react';
import { Note } from '../../../shared/types';
import { useAppStore } from '../../stores/appStore';
import iconSlack from '../../assets/icon-slack.png';
import iconClipboard from '../../assets/icon-clipboard.png';
import './NoteItem.css';

interface NoteItemProps {
  dayId: string;
  sectionId: string;
  note: Note;
}

function NoteItem({ dayId, sectionId, note }: NoteItemProps) {
  const { updateNote, deleteNote, addNotification, sendToTargetWindow, automationSupported, isEditMode, selectedItemIds, toggleItemSelection, getCurrentProfile } = useAppStore();
  const currentProfile = getCurrentProfile();
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(note.title);
  const [editContent, setEditContent] = useState(note.content);
  const [isExpanded, setIsExpanded] = useState(false);

  const handleSave = () => {
    if (editTitle.trim() && editContent.trim()) {
      updateNote(dayId, sectionId, note.id, {
        title: editTitle.trim(),
        content: editContent.trim(),
      });
      setIsEditing(false);
    }
  };

  const handleCancelEdit = () => {
    setIsEditing(false);
    setEditTitle(note.title);
    setEditContent(note.content);
  };

  const handleFocusAndPaste = async () => {
    const result = await sendToTargetWindow(
      note.content,
      currentProfile.settings.windowTarget.pressEnterAfterPaste
    );

    if (!result.success) {
      addNotification(result.error || 'Failed to paste note', 'error');
    }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(note.content);
      addNotification('Note copied to clipboard', 'success');
    } catch {
      addNotification('Failed to copy note', 'error');
    }
  };

  const isSelected = selectedItemIds.has(note.id);
  const [isDragging, setIsDragging] = useState(false);

  const handleDragStart = (e: DragEvent<HTMLDivElement>) => {
    e.dataTransfer.setData('application/json', JSON.stringify({
      itemId: note.id,
      sourceDayId: dayId,
      sourceSectionId: sectionId,
    }));
    e.dataTransfer.effectAllowed = 'move';
    setIsDragging(true);
  };

  const handleDragEnd = () => {
    setIsDragging(false);
  };

  if (isEditing) {
    return (
      <div className="add-item-form">
        <div className="add-item-fields">
          <input
            type="text"
            className="input"
            placeholder="Note title..."
            value={editTitle}
            onChange={(e) => setEditTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') handleCancelEdit();
            }}
            autoFocus
          />
          <textarea
            className="textarea"
            placeholder="Content to paste..."
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
    <div
      className={`note-item ${isSelected ? 'note-item--selected' : ''} ${isDragging ? 'note-item--dragging' : ''}`}
      draggable={isEditMode}
      onDragStart={isEditMode ? handleDragStart : undefined}
      onDragEnd={isEditMode ? handleDragEnd : undefined}
    >
      {isEditMode && (
        <input
          type="checkbox"
          className="item-checkbox"
          checked={isSelected}
          onChange={() => toggleItemSelection(note.id)}
        />
      )}
      <div className="note-info">
        <span className="note-icon">📝</span>
        <span
          className="note-title truncate"
          onClick={() => setIsExpanded(!isExpanded)}
          title="Click to expand"
        >
          {note.title}
        </span>
      </div>

      {isExpanded && (
        <div className="note-content-preview">{note.content}</div>
      )}

      <div className="note-actions">
        <button
          className="note-action-btn"
          onClick={handleFocusAndPaste}
          title={automationSupported ? 'Focus window and paste' : 'Copy to clipboard (auto-paste isn\'t available on this platform)'}
        >
          <img src={iconSlack} alt="Focus & Paste" className="note-action-icon" />
        </button>
        <button
          className="note-action-btn"
          onClick={handleCopy}
          title="Copy to clipboard"
        >
          <img src={iconClipboard} alt="Copy" className="note-action-icon" />
        </button>
        {isEditMode && (
          <>
            <button
              className="note-action-btn"
              onClick={() => setIsEditing(true)}
              title="Edit"
            >
              <span className="note-action-text">✎</span>
            </button>
            <button
              className="note-action-btn note-action-btn--delete"
              onClick={() => {
                if (confirm(`Delete "${note.title}"?`)) {
                  deleteNote(dayId, sectionId, note.id);
                }
              }}
              title="Delete"
            >
              <span className="note-action-text">✕</span>
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export default NoteItem;
