import React, { useState } from 'react';
import { useAppStore } from '../../stores/appStore';
import { useOverlayDismiss } from '../../hooks/useOverlayDismiss';
import { AdditionalUrl } from '../../../shared/types';
import './AddItemForm.css';

interface AddItemFormProps {
  dayId: string;
  sectionId: string;
  onClose: () => void;
}

type ItemType = 'link' | 'multilink' | 'note';

interface MultiLinkEntry {
  url: string;
  title: string;
}

function AddItemForm({ dayId, sectionId, onClose }: AddItemFormProps) {
  const { addLink, addNote, addNotification } = useAppStore();
  const [itemType, setItemType] = useState<ItemType>('link');
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [isFetching, setIsFetching] = useState(false);

  // Multi-link state
  const [groupTitle, setGroupTitle] = useState('');
  const [multiLinks, setMultiLinks] = useState<MultiLinkEntry[]>([{ url: '', title: '' }]);

  const handleAddLink = async () => {
    if (!url.trim()) return;

    let finalTitle = title.trim();

    if (!finalTitle) {
      setIsFetching(true);
      try {
        finalTitle = await window.electronAPI.fetchTitle(url.trim());
      } catch {
        finalTitle = url.trim();
      }
      setIsFetching(false);
    }

    addLink(dayId, sectionId, url.trim(), finalTitle);
    onClose();
  };

  const handleAddMultiLink = async () => {
    const validEntries = multiLinks.filter(e => e.url.trim());
    if (validEntries.length === 0) return;

    const finalGroupTitle = groupTitle.trim() || 'Link Group';

    setIsFetching(true);

    // Fetch titles for entries missing them
    const resolved = await Promise.all(
      validEntries.map(async (entry) => {
        let t = entry.title.trim();
        if (!t) {
          try {
            t = await window.electronAPI.fetchTitle(entry.url.trim());
          } catch {
            t = entry.url.trim();
          }
        }
        return { url: entry.url.trim(), title: t };
      })
    );

    setIsFetching(false);

    const primaryUrl = resolved[0].url;
    const primaryTitle = finalGroupTitle;
    const additional: AdditionalUrl[] = resolved.map(r => ({ url: r.url, title: r.title }));

    addLink(dayId, sectionId, primaryUrl, primaryTitle, additional);
    onClose();
  };

  const handleAddNote = () => {
    if (!title.trim() || !content.trim()) return;
    addNote(dayId, sectionId, title.trim(), content.trim());
    onClose();
  };

  const handleSubmit = () => {
    if (itemType === 'link') {
      handleAddLink();
    } else if (itemType === 'multilink') {
      handleAddMultiLink();
    } else {
      handleAddNote();
    }
  };

  const updateMultiLink = (index: number, field: 'url' | 'title', value: string) => {
    setMultiLinks(prev => prev.map((e, i) => i === index ? { ...e, [field]: value } : e));
  };

  const addMultiLinkRow = () => {
    setMultiLinks(prev => [...prev, { url: '', title: '' }]);
  };

  const removeMultiLinkRow = (index: number) => {
    if (multiLinks.length <= 1) return;
    setMultiLinks(prev => prev.filter((_, i) => i !== index));
  };

  const overlayDismiss = useOverlayDismiss(onClose);

  return (
    <div className="add-item-overlay" {...overlayDismiss}>
    <div className="add-item-form" onClick={(e) => e.stopPropagation()}>
      <div className="add-item-type-selector">
        <button
          className={`add-item-type-btn ${itemType === 'link' ? 'add-item-type-btn--active' : ''}`}
          onClick={() => setItemType('link')}
        >
          🔗 LINK
        </button>
        <button
          className={`add-item-type-btn ${itemType === 'multilink' ? 'add-item-type-btn--active' : ''}`}
          onClick={() => setItemType('multilink')}
        >
          🔗 MULTI LINK
        </button>
        <button
          className={`add-item-type-btn ${itemType === 'note' ? 'add-item-type-btn--active' : ''}`}
          onClick={() => setItemType('note')}
        >
          📝 NOTE
        </button>
      </div>

      {itemType === 'link' ? (
        <div className="add-item-fields">
          <input
            type="text"
            className="input"
            placeholder="URL..."
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSubmit();
              if (e.key === 'Escape') onClose();
            }}
            autoFocus
          />
          <input
            type="text"
            className="input"
            placeholder="Title (auto-fetch if empty)..."
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSubmit();
              if (e.key === 'Escape') onClose();
            }}
          />
        </div>
      ) : itemType === 'multilink' ? (
        <div className="add-item-fields">
          <input
            type="text"
            className="input"
            placeholder="Group title..."
            value={groupTitle}
            onChange={(e) => setGroupTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') onClose();
            }}
            autoFocus
          />
          <div className="multi-link-entries">
            {multiLinks.map((entry, index) => (
              <div className="multi-link-entry" key={index}>
                <div className="multi-link-entry-fields">
                  <input
                    type="text"
                    className="input"
                    placeholder="URL..."
                    value={entry.url}
                    onChange={(e) => updateMultiLink(index, 'url', e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') onClose();
                    }}
                  />
                  <input
                    type="text"
                    className="input"
                    placeholder="Title (auto-fetch if empty)..."
                    value={entry.title}
                    onChange={(e) => updateMultiLink(index, 'title', e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') onClose();
                    }}
                  />
                </div>
                {multiLinks.length > 1 && (
                  <button
                    className="btn btn--small btn--danger multi-link-remove-btn"
                    onClick={() => removeMultiLinkRow(index)}
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
            onClick={addMultiLinkRow}
          >
            + ADD URL
          </button>
        </div>
      ) : (
        <div className="add-item-fields">
          <input
            type="text"
            className="input"
            placeholder="Note title..."
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') onClose();
            }}
            autoFocus
          />
          <textarea
            className="textarea"
            placeholder="Content to paste..."
            value={content}
            onChange={(e) => setContent(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') onClose();
            }}
          />
        </div>
      )}

      <div className="add-item-actions">
        <button
          className="btn btn--small btn--success"
          onClick={handleSubmit}
          disabled={isFetching}
        >
          {isFetching ? 'FETCHING...' : 'ADD'}
        </button>
        <button className="btn btn--small btn--secondary" onClick={onClose}>
          CANCEL
        </button>
      </div>
    </div>
    </div>
  );
}

export default AddItemForm;
