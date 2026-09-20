import React, { useState, DragEvent } from 'react';
import { Day } from '../../../shared/types';
import { useAppStore } from '../../stores/appStore';
import SectionComponent from '../Section/Section';
import MoveDialog from '../common/MoveDialog';
import './DayView.css';

interface DayViewProps {
  day: Day;
}

function DayView({ day }: DayViewProps) {
  const { addSection, isEditMode, selectedItemIds, selectedSectionIds, clearSelections, reorderSection } = useAppStore();
  const [isAdding, setIsAdding] = useState(false);
  const [newSectionName, setNewSectionName] = useState('');
  const [showMoveDialog, setShowMoveDialog] = useState(false);
  const [dragOverSectionId, setDragOverSectionId] = useState<string | null>(null);

  const handleSectionDragOver = (e: DragEvent<HTMLDivElement>) => {
    if (!e.dataTransfer.types.includes('application/section-reorder')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const target = (e.target as HTMLElement).closest('[data-section-id]') as HTMLElement | null;
    if (target) {
      setDragOverSectionId(target.dataset.sectionId || null);
    }
  };

  const handleSectionDrop = (e: DragEvent<HTMLDivElement>) => {
    if (!e.dataTransfer.types.includes('application/section-reorder')) return;
    e.preventDefault();
    setDragOverSectionId(null);
    try {
      const data = JSON.parse(e.dataTransfer.getData('application/section-reorder'));
      const target = (e.target as HTMLElement).closest('[data-section-id]') as HTMLElement | null;
      if (!target) return;
      const toSectionId = target.dataset.sectionId;
      const fromSectionId = data.sectionId;
      if (fromSectionId && toSectionId && fromSectionId !== toSectionId) {
        reorderSection(day.id, fromSectionId, toSectionId);
      }
    } catch {}
  };

  const handleSectionDragLeave = (e: DragEvent<HTMLDivElement>) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setDragOverSectionId(null);
    }
  };

  const handleAddSection = () => {
    if (newSectionName.trim()) {
      addSection(day.id, newSectionName.trim());
      setNewSectionName('');
      setIsAdding(false);
    }
  };

  const totalSelected = selectedItemIds.size + selectedSectionIds.size;

  const handleSelectAll = () => {
    const { toggleItemSelection, toggleSectionSelection } = useAppStore.getState();
    day.sections.forEach((section) => {
      if (!selectedSectionIds.has(section.id)) {
        toggleSectionSelection(section.id);
      }
      section.items.forEach((item) => {
        if (!selectedItemIds.has(item.id)) {
          toggleItemSelection(item.id);
        }
      });
    });
  };

  return (
    <div className="day-view">
      <div
        className="day-sections"
        onDragOver={isEditMode ? handleSectionDragOver : undefined}
        onDrop={isEditMode ? handleSectionDrop : undefined}
        onDragLeave={isEditMode ? handleSectionDragLeave : undefined}
      >
        {day.sections
          .sort((a, b) => a.order - b.order)
          .map((section) => (
            <div key={section.id} className={dragOverSectionId === section.id ? 'section--section-drag-over' : ''}>
              <SectionComponent dayId={day.id} section={section} />
            </div>
          ))}
      </div>

      {isEditMode && (
        isAdding ? (
          <div className="day-add-section-form">
            <input
              type="text"
              className="input"
              placeholder="Section name..."
              value={newSectionName}
              onChange={(e) => setNewSectionName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleAddSection();
                if (e.key === 'Escape') {
                  setIsAdding(false);
                  setNewSectionName('');
                }
              }}
              autoFocus
            />
            <div className="day-add-section-actions">
              <button className="btn btn--small btn--success" onClick={handleAddSection}>
                ADD
              </button>
              <button
                className="btn btn--small btn--secondary"
                onClick={() => {
                  setIsAdding(false);
                  setNewSectionName('');
                }}
              >
                CANCEL
              </button>
            </div>
          </div>
        ) : (
          <button
            className="btn day-add-section-btn"
            onClick={() => setIsAdding(true)}
          >
            + SECTION
          </button>
        )
      )}

      {isEditMode && (
        <div className="edit-action-bar">
          <button className="btn btn--small" onClick={handleSelectAll}>
            SELECT ALL
          </button>
          <button className="btn btn--small btn--secondary" onClick={clearSelections}>
            CLEAR
          </button>
          <button
            className="btn btn--small btn--success"
            disabled={totalSelected === 0}
            onClick={() => setShowMoveDialog(true)}
          >
            MOVE ({totalSelected})
          </button>
        </div>
      )}

      {showMoveDialog && (
        <MoveDialog
          onClose={() => setShowMoveDialog(false)}
          hasItems={selectedItemIds.size > 0}
          hasSections={selectedSectionIds.size > 0}
        />
      )}
    </div>
  );
}

export default DayView;
