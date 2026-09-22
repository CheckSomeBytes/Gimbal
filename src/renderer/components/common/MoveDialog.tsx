import React, { useState } from 'react';
import { useAppStore } from '../../stores/appStore';
import { useOverlayDismiss } from '../../hooks/useOverlayDismiss';
import './MoveDialog.css';

interface MoveDialogProps {
  onClose: () => void;
  hasItems: boolean;
  hasSections: boolean;
}

function MoveDialog({ onClose, hasItems, hasSections }: MoveDialogProps) {
  const { moveItems, moveSections, getCurrentProfile } = useAppStore();
  const currentProfile = getCurrentProfile();
  const [selectedDayId, setSelectedDayId] = useState<string | null>(null);
  const [selectedSectionId, setSelectedSectionId] = useState<string | null>(null);

  const sortedDays = [...currentProfile.days].sort((a, b) => a.order - b.order);
  const selectedDay = sortedDays.find((d) => d.id === selectedDayId);

  const handleConfirm = () => {
    if (hasSections && selectedDayId) {
      moveSections(selectedDayId);
    }
    if (hasItems && selectedDayId && selectedSectionId) {
      moveItems(selectedDayId, selectedSectionId);
    }
    onClose();
  };

  const canConfirm = selectedDayId && (!hasItems || selectedSectionId);

  const overlayDismiss = useOverlayDismiss(onClose);

  return (
    <div className="move-dialog-overlay" {...overlayDismiss}>
      <div className="move-dialog" onClick={(e) => e.stopPropagation()}>
        <h3 className="move-dialog-title">MOVE TO</h3>

        <div className="move-dialog-tree">
          <label className="move-dialog-label">Day:</label>
          <div className="move-dialog-options">
            {sortedDays.map((day) => (
              <button
                key={day.id}
                className={`move-dialog-option ${selectedDayId === day.id ? 'move-dialog-option--active' : ''}`}
                onClick={() => {
                  setSelectedDayId(day.id);
                  setSelectedSectionId(null);
                }}
              >
                {day.name}
              </button>
            ))}
          </div>

          {hasItems && selectedDay && (
            <>
              <label className="move-dialog-label">Section:</label>
              <div className="move-dialog-options">
                {selectedDay.sections
                  .sort((a, b) => a.order - b.order)
                  .map((section) => (
                    <button
                      key={section.id}
                      className={`move-dialog-option ${selectedSectionId === section.id ? 'move-dialog-option--active' : ''}`}
                      onClick={() => setSelectedSectionId(section.id)}
                    >
                      {section.name}
                    </button>
                  ))}
              </div>
            </>
          )}
        </div>

        <div className="move-dialog-actions">
          <button className="btn btn--small btn--secondary" onClick={onClose}>
            CANCEL
          </button>
          <button
            className="btn btn--small btn--success"
            disabled={!canConfirm}
            onClick={handleConfirm}
          >
            CONFIRM
          </button>
        </div>
      </div>
    </div>
  );
}

export default MoveDialog;
