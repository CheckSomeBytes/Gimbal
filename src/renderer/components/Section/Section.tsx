import React, { useState, DragEvent } from 'react';
import { Section } from '../../../shared/types';
import { useAppStore } from '../../stores/appStore';
import LinkItem from '../Link/LinkItem';
import NoteItem from '../Note/NoteItem';
import PollItem from '../Poll/PollItem';
import AddItemForm from './AddItemForm';
import AddPollForm from './AddPollForm';
import './Section.css';

interface SectionProps {
  dayId: string;
  section: Section;
}

function SectionComponent({ dayId, section }: SectionProps) {
  const { updateSection, deleteSection, toggleSectionCollapse, isEditMode, selectedSectionIds, toggleSectionSelection, moveItemToSection, resetSectionPolls, assignLabToSection, unassignLabFromSection, addNotification, getCurrentProfile, setOpenLabNotesLabNumber } = useAppStore();
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(section.name);
  const [isAddingItem, setIsAddingItem] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [isLabDragOver, setIsLabDragOver] = useState(false);
  const [showPolls, setShowPolls] = useState(false);
  const [isAddingPoll, setIsAddingPoll] = useState(false);
  const [isSectionDragging, setIsSectionDragging] = useState(false);
  const currentProfile = getCurrentProfile();

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    // Check if this is a lab assignment drag
    if (e.dataTransfer.types.includes('application/lab-assign')) {
      e.dataTransfer.dropEffect = 'copy';
      return;
    }
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDragEnter = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (e.dataTransfer.types.includes('application/lab-assign')) {
      setIsLabDragOver(true);
    } else {
      setIsDragOver(true);
    }
  };

  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setIsDragOver(false);
      setIsLabDragOver(false);
    }
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(false);
    setIsLabDragOver(false);

    // Handle lab assignment drop
    if (e.dataTransfer.types.includes('application/lab-assign')) {
      try {
        const data = JSON.parse(e.dataTransfer.getData('application/lab-assign'));
        // If dragged from another section, remove it from source first
        if (data.sourceSectionId && data.sourceSectionId !== section.id) {
          unassignLabFromSection(data.sourceDayId, data.sourceSectionId);
        }
        // Don't re-assign to same section
        if (data.sourceSectionId !== section.id) {
          assignLabToSection(dayId, section.id, data.labNumber);
          addNotification(`Lab ${data.labNumber} assigned to ${section.name}`, 'success');
        }
      } catch {}
      return;
    }

    // If this is a section reorder drop, ignore here (handled by DayView)
    if (e.dataTransfer.types.includes('application/section-reorder')) return;
    try {
      const data = JSON.parse(e.dataTransfer.getData('application/json'));
      moveItemToSection(data.itemId, data.sourceDayId, data.sourceSectionId, dayId, section.id);
    } catch {}
  };

  const handleSectionDragStart = (e: DragEvent<HTMLSpanElement>) => {
    e.dataTransfer.setData('application/section-reorder', JSON.stringify({
      sectionId: section.id,
      order: section.order,
    }));
    e.dataTransfer.effectAllowed = 'move';
    setIsSectionDragging(true);
  };

  const handleSectionDragEnd = () => {
    setIsSectionDragging(false);
  };

  const handleSave = () => {
    if (editName.trim()) {
      updateSection(dayId, section.id, editName.trim());
      setIsEditing(false);
    }
  };

  const sortedItems = [...section.items].sort((a, b) => a.order - b.order);
  const sortedPolls = [...(section.polls || [])].sort((a, b) => a.order - b.order);
  const isSectionSelected = selectedSectionIds.has(section.id);
  const hasItems = sortedItems.length > 0;
  const hasPollsToShow = sortedPolls.length > 0;
  const newPollsCount = sortedPolls.filter((p) => !p.sent).length;
  const hasSentPolls = sortedPolls.some((p) => p.sent);

  return (
    <div
      className={`section panel ${isSectionSelected ? 'section--selected' : ''} ${isDragOver && isEditMode ? 'section--drag-over' : ''} ${isLabDragOver && isEditMode ? 'section--lab-drag-over' : ''} ${isSectionDragging ? 'section--dragging' : ''}`}
      data-section-id={section.id}
      data-section-order={section.order}
      onDragOver={isEditMode ? handleDragOver : undefined}
      onDragEnter={isEditMode ? handleDragEnter : undefined}
      onDragLeave={isEditMode ? handleDragLeave : undefined}
      onDrop={isEditMode ? handleDrop : undefined}
    >
      <div className={`section-header ${section.isCollapsed ? 'section-header--collapsed' : ''} ${!hasItems ? 'section-header--empty' : ''}`}>
        {isEditMode && (
          <span
            className="section-drag-handle"
            draggable
            onDragStart={handleSectionDragStart}
            onDragEnd={handleSectionDragEnd}
            title="Drag to reorder"
          >⠿</span>
        )}
        {isEditMode && (
          <input
            type="checkbox"
            className="section-checkbox"
            checked={isSectionSelected}
            onChange={() => toggleSectionSelection(section.id)}
          />
        )}
        {hasItems && (
          <button
            className="section-collapse-btn"
            onClick={() => toggleSectionCollapse(dayId, section.id)}
          >
            {section.isCollapsed ? '▶' : '▼'}
          </button>
        )}

        {isEditing ? (
          <div className="section-edit">
            <input
              type="text"
              className="input"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSave();
                if (e.key === 'Escape') {
                  setIsEditing(false);
                  setEditName(section.name);
                }
              }}
              autoFocus
            />
            <button className="btn btn--small btn--success" onClick={handleSave}>
              ✓
            </button>
            <button
              className="btn btn--small btn--secondary"
              onClick={() => {
                setIsEditing(false);
                setEditName(section.name);
              }}
            >
              ✕
            </button>
          </div>
        ) : (
          <>
            <h3 className="section-title">{section.name}</h3>
            {/* Assigned Lab Badge - always in same position, to the left of polls */}
            <div className="section-lab-wrapper">
              {isEditMode && section.assignedLab && (
                <button
                  className="section-lab-remove"
                  onClick={() => unassignLabFromSection(dayId, section.id)}
                  title="Remove lab assignment"
                >
                  ✕
                </button>
              )}
              {section.assignedLab && (
                <button
                  className={`section-lab-badge ${currentProfile.settings.labNotes?.[section.assignedLab!] ? 'section-lab-badge--has-notes' : ''}`}
                  onClick={() => setOpenLabNotesLabNumber(section.assignedLab!)}
                  draggable={isEditMode}
                  onDragStart={(e) => {
                    e.dataTransfer.setData('application/lab-assign', JSON.stringify({
                      labNumber: section.assignedLab,
                      sourceDayId: dayId,
                      sourceSectionId: section.id,
                    }));
                    e.dataTransfer.effectAllowed = 'move';
                  }}
                  title={isEditMode ? `Lab ${section.assignedLab} - Click to open notes, drag to move` : `Click to open Lab ${section.assignedLab} notes`}
                >
                  {section.assignedLab}
                </button>
              )}
            </div>
            {/* Read mode: polls button wrapper (always rendered for alignment) */}
            {!isEditMode && (
              <div className="section-poll-btn-wrapper">
                {hasPollsToShow && (
                  <>
                    <button
                      className={`section-action-btn section-action-btn--visible ${showPolls ? 'section-action-btn--active' : ''}`}
                      onClick={() => setShowPolls(!showPolls)}
                      title={showPolls ? 'Hide polls' : 'Show polls'}
                    >
                      📊
                    </button>
                    <span className="section-poll-badge-inline">{newPollsCount}</span>
                  </>
                )}
              </div>
            )}
            {/* Edit mode: all edit buttons */}
            {isEditMode && (
              <div className="section-actions section-actions--visible">
                <div className="section-poll-btn-wrapper">
                  <button
                    className={`section-action-btn ${showPolls ? 'section-action-btn--active' : ''}`}
                    onClick={() => setShowPolls(!showPolls)}
                    title="Edit polls"
                  >
                    📊
                  </button>
                  {newPollsCount > 0 && (
                    <span className="section-poll-badge-inline">{newPollsCount}</span>
                  )}
                </div>
                <button
                  className="section-action-btn"
                  onClick={() => setIsEditing(true)}
                  title="Edit section"
                >
                  ✎
                </button>
                <button
                  className="section-action-btn section-action-btn--danger"
                  onClick={() => {
                    if (confirm(`Delete "${section.name}" and all its contents?`)) {
                      deleteSection(dayId, section.id);
                    }
                  }}
                  title="Delete section"
                >
                  ✕
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* Polls popup */}
      {showPolls && (
        <div className="section-polls-overlay" onClick={() => setShowPolls(false)}>
          <div className="section-polls-popup" onClick={(e) => e.stopPropagation()}>
            <div className="section-polls-header">
              <span className="section-polls-title">Polls - {section.name}</span>
              <button
                className="btn btn--small btn--danger"
                onClick={() => setShowPolls(false)}
              >
                ✕
              </button>
            </div>
            <div className="section-polls-list">
              {sortedPolls.map((poll) => (
                <PollItem
                  key={poll.id}
                  dayId={dayId}
                  sectionId={section.id}
                  poll={poll}
                />
              ))}
              {sortedPolls.length === 0 && !isAddingPoll && (
                <div className="section-polls-empty">No polls yet</div>
              )}
            </div>
            {isEditMode && (
              isAddingPoll ? (
                <AddPollForm
                  dayId={dayId}
                  sectionId={section.id}
                  onClose={() => setIsAddingPoll(false)}
                />
              ) : (
                <div className="section-polls-actions">
                  <button
                    className="btn btn--small section-add-btn"
                    onClick={() => setIsAddingPoll(true)}
                  >
                    + ADD POLL
                  </button>
                  {hasSentPolls && (
                    <button
                      className="btn btn--small btn--secondary"
                      onClick={() => resetSectionPolls(dayId, section.id)}
                    >
                      RESET ALL
                    </button>
                  )}
                </div>
              )
            )}
          </div>
        </div>
      )}

      {(!section.isCollapsed || !hasItems) && (
        <div className="section-content">
          {/* Items section */}
          <div className="section-items">
            {sortedItems.map((item) =>
              item.type === 'link' ? (
                <LinkItem
                  key={item.id}
                  dayId={dayId}
                  sectionId={section.id}
                  link={item}
                />
              ) : (
                <NoteItem
                  key={item.id}
                  dayId={dayId}
                  sectionId={section.id}
                  note={item}
                />
              )
            )}
          </div>

          {isEditMode && (isAddingItem ? (
            <AddItemForm
              dayId={dayId}
              sectionId={section.id}
              onClose={() => setIsAddingItem(false)}
            />
          ) : (
            <button
              className="btn btn--small section-add-btn"
              onClick={() => setIsAddingItem(true)}
            >
              + ADD
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default SectionComponent;
