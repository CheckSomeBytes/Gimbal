import React, { useEffect, useRef, useState } from 'react';
import { useAppStore } from '../../stores/appStore';
import { useOverlayDismiss } from '../../hooks/useOverlayDismiss';
import './TodoPopup.css';

function TodoPopup() {
  const {
    isTodoPopupOpen,
    setTodoPopupOpen,
    addTodo,
    toggleTodo,
    updateTodo,
    deleteTodo,
    clearAllTodos,
    getCurrentProfile,
  } = useAppStore();

  const todos = getCurrentProfile().settings.todos || [];

  const [draft, setDraft] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // Reset transient state each time the popup opens.
  useEffect(() => {
    if (isTodoPopupOpen) {
      setDraft('');
      setEditingId(null);
      inputRef.current?.focus();
    }
  }, [isTodoPopupOpen]);

  // Declared before the early return: hooks must run in the same order on
  // every render, open or closed.
  const overlayDismiss = useOverlayDismiss(() => setTodoPopupOpen(false));

  if (!isTodoPopupOpen) return null;

  const openCount = todos.filter((t) => !t.done).length;
  const doneCount = todos.length - openCount;

  const handleAdd = () => {
    if (!draft.trim()) return;
    addTodo(draft);
    setDraft('');
    inputRef.current?.focus();
  };

  const handleClearAll = () => {
    const count = todos.length;
    if (
      confirm(
        `Clear all ${count} task${count === 1 ? '' : 's'}?\n\nThis action cannot be undone.`
      )
    ) {
      clearAllTodos();
    }
  };

  const commitEdit = () => {
    if (editingId && editText.trim()) {
      updateTodo(editingId, editText);
    }
    setEditingId(null);
  };

  const close = () => setTodoPopupOpen(false);

  return (
    <div className="lab-popup-overlay lab-popup-overlay--top-anchored" {...overlayDismiss}>
      <div className="lab-popup todo-popup" onClick={(e) => e.stopPropagation()}>
        <div className="lab-popup-header">
          <span className="lab-popup-title">
            TODO
            {todos.length > 0 && (
              <span className="todo-header-count">
                {openCount} open{doneCount > 0 ? ` · ${doneCount} done` : ''}
              </span>
            )}
          </span>
          <div className="lab-popup-header-right">
            {todos.length > 0 && (
              <button
                className="btn btn--small btn--secondary"
                onClick={handleClearAll}
                title="Remove every task"
              >
                CLEAR ALL
              </button>
            )}
            <button className="btn btn--small btn--danger" onClick={close} title="Close">
              ✕
            </button>
          </div>
        </div>

        <div className="lab-popup-content todo-content">
          <div className="todo-add-row">
            <input
              ref={inputRef}
              type="text"
              className="input todo-input"
              placeholder="Add a task..."
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleAdd();
                else if (e.key === 'Escape') close();
              }}
            />
            <button
              className="btn btn--small btn--success"
              onClick={handleAdd}
              disabled={!draft.trim()}
            >
              ADD
            </button>
          </div>

          {todos.length === 0 ? (
            <div className="todo-empty">No tasks yet. Add one above.</div>
          ) : (
            <ul className="todo-list">
              {todos.map((todo) => (
                <li
                  key={todo.id}
                  className={`todo-item ${todo.done ? 'todo-item--done' : ''}`}
                >
                  <input
                    type="checkbox"
                    className="todo-checkbox"
                    checked={todo.done}
                    onChange={() => toggleTodo(todo.id)}
                    title={todo.done ? 'Mark as open' : 'Mark as done'}
                  />
                  {editingId === todo.id ? (
                    <input
                      type="text"
                      className="input todo-edit-input"
                      value={editText}
                      onChange={(e) => setEditText(e.target.value)}
                      onBlur={commitEdit}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') commitEdit();
                        else if (e.key === 'Escape') setEditingId(null);
                      }}
                      autoFocus
                    />
                  ) : (
                    <span
                      className="todo-text"
                      onClick={() => {
                        setEditingId(todo.id);
                        setEditText(todo.text);
                      }}
                      title="Click to edit"
                    >
                      {todo.text}
                    </span>
                  )}
                  <button
                    className="todo-delete-btn"
                    onClick={() => deleteTodo(todo.id)}
                    title="Delete task"
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

export default TodoPopup;
