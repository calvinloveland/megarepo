'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

type SubmissionState =
  | { kind: 'idle'; message: string }
  | { kind: 'success'; message: string }
  | { kind: 'error'; message: string };

const defaultCatalogRequestText = "I'd love to request an artist or artwork that is missing from the Vernissage catalog.";

function getElementPath(element: HTMLElement) {
  const parts: string[] = [];
  let current: HTMLElement | null = element;

  while (current && current !== document.body) {
    let selector = current.tagName.toLowerCase();
    if (current.id) {
      selector += `#${current.id}`;
    } else if (current.className) {
      const classes = current.className
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2);
      if (classes.length) {
        selector += `.${classes.join('.')}`;
      }
    }
    parts.unshift(selector);
    current = current.parentElement;
  }

  return parts.join(' > ');
}

function getElementDescription(element: HTMLElement) {
  if (element.id) {
    return `${element.tagName.toLowerCase()}#${element.id}`;
  }
  if (element.className) {
    const className = element.className.split(/\s+/).filter(Boolean)[0];
    if (className) {
      return `${element.tagName.toLowerCase()}.${className}`;
    }
  }
  return element.tagName.toLowerCase();
}

export function FeedbackWidget() {
  const [open, setOpen] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [feedbackText, setFeedbackText] = useState('');
  const [selectedElement, setSelectedElement] = useState('');
  const [selectionLabel, setSelectionLabel] = useState('Click to select element');
  const [submission, setSubmission] = useState<SubmissionState>({ kind: 'idle', message: '' });
  const rootRef = useRef<HTMLDivElement | null>(null);
  const toggleButtonRef = useRef<HTMLButtonElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const hoveredRef = useRef<HTMLElement | null>(null);
  const originalOutlineRef = useRef('');

  const openPanel = useCallback((initialText?: string) => {
    setOpen(true);
    setSelecting(false);
    setSubmission({ kind: 'idle', message: '' });
    setSelectedElement('');
    setSelectionLabel('Click to select element');
    if (initialText) {
      setFeedbackText((current) => current.trim() || initialText);
    }
  }, []);

  useEffect(() => {
    if (open) {
      textareaRef.current?.focus();
      return;
    }
    toggleButtonRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !selecting) {
        setOpen(false);
        setSubmission({ kind: 'idle', message: '' });
      }
    };

    document.addEventListener('keydown', handleEscape, true);
    return () => document.removeEventListener('keydown', handleEscape, true);
  }, [open, selecting]);

  useEffect(() => {
    const handleOpenRequest = (event: Event) => {
      const detail = event instanceof CustomEvent ? event.detail as { initialText?: string } | undefined : undefined;
      openPanel(detail?.initialText);
    };

    window.addEventListener('vernissage-feedback:open', handleOpenRequest);
    return () => window.removeEventListener('vernissage-feedback:open', handleOpenRequest);
  }, [openPanel]);

  useEffect(() => {
    const openFromHash = () => {
      if (window.location.hash === '#vernissage-feedback-request') {
        openPanel(defaultCatalogRequestText);
      }
    };

    openFromHash();
    window.addEventListener('hashchange', openFromHash);
    return () => window.removeEventListener('hashchange', openFromHash);
  }, [openPanel]);

  useEffect(() => {
    if (!selecting) {
      return undefined;
    }

    const highlightElement = (event: MouseEvent) => {
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (!target || rootRef.current?.contains(target)) {
        return;
      }

      if (hoveredRef.current && hoveredRef.current !== target) {
        hoveredRef.current.style.outline = originalOutlineRef.current;
      }

      hoveredRef.current = target;
      originalOutlineRef.current = target.style.outline;
      target.style.outline = '2px solid #b98b1b';
    };

    const unhighlightElement = () => {
      if (hoveredRef.current) {
        hoveredRef.current.style.outline = originalOutlineRef.current;
      }
    };

    const stopSelecting = () => {
      if (hoveredRef.current) {
        hoveredRef.current.style.outline = originalOutlineRef.current;
        hoveredRef.current = null;
      }
      setSelecting(false);
    };

    const selectElement = (event: MouseEvent) => {
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (!target || rootRef.current?.contains(target)) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      const path = getElementPath(target);
      setSelectedElement(path);
      setSelectionLabel(`Selected: ${getElementDescription(target)}`);
      stopSelecting();
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        stopSelecting();
      }
    };

    document.body.style.cursor = 'crosshair';
    document.addEventListener('mouseover', highlightElement, true);
    document.addEventListener('mouseout', unhighlightElement, true);
    document.addEventListener('click', selectElement, true);
    document.addEventListener('keydown', handleEscape, true);

    return () => {
      document.body.style.cursor = 'default';
      document.removeEventListener('mouseover', highlightElement, true);
      document.removeEventListener('mouseout', unhighlightElement, true);
      document.removeEventListener('click', selectElement, true);
      document.removeEventListener('keydown', handleEscape, true);
      if (hoveredRef.current) {
        hoveredRef.current.style.outline = originalOutlineRef.current;
        hoveredRef.current = null;
      }
    };
  }, [selecting]);

  const canSubmit = useMemo(() => feedbackText.trim().length > 0, [feedbackText]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmission({ kind: 'idle', message: '' });

    try {
      const response = await fetch('/feedback', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          feedback_text: feedbackText,
          selected_element: selectedElement,
          design: 'gilded-manuscript',
          page_path: `${window.location.pathname}${window.location.search}`,
          page_title: document.title,
          timestamp: new Date().toISOString()
        })
      });

      if (!response.ok) {
        throw new Error((await response.text()) || 'Failed to submit feedback.');
      }

      setFeedbackText('');
      setSelectedElement('');
      setSelectionLabel('Click to select element');
      setSubmission({ kind: 'success', message: 'Feedback submitted successfully.' });

      window.setTimeout(() => {
        setOpen(false);
        setSubmission({ kind: 'idle', message: '' });
      }, 1800);
    } catch (error) {
      setSubmission({
        kind: 'error',
        message: error instanceof Error ? error.message : 'Failed to submit feedback.'
      });
    }
  }

  function clearSelection() {
    setSelectedElement('');
    setSelectionLabel('Click to select element');
    setSelecting(false);
  }

  return (
    <div ref={rootRef} className="feedback-widget" id="vernissage-feedback-request">
        <button
          ref={toggleButtonRef}
          type="button"
          className="feedback-widget__toggle"
          onClick={() => {
          setOpen((current) => !current);
          setSelecting(false);
          setSubmission({ kind: 'idle', message: '' });
          }}
          aria-expanded={open}
          aria-controls="vernissage-feedback-panel"
          aria-haspopup="dialog"
        >
          <span className="feedback-widget__crest">✶</span>
          <span className="feedback-widget__toggle-label">Feedback</span>
      </button>

      {open ? (
        <div
          id="vernissage-feedback-panel"
          className="feedback-widget__panel"
          role="dialog"
          aria-modal="false"
          aria-labelledby="vernissage-feedback-title"
          aria-describedby="vernissage-feedback-description"
        >
          <div className="feedback-widget__header">
            <div>
              <p className="eyebrow">House notes</p>
              <h2 id="vernissage-feedback-title">Send feedback</h2>
              <p id="vernissage-feedback-description" className="feedback-widget__hint">
                 Share bugs, rough edges, catalog requests, or launch notes. Press Escape to close this panel.
               </p>
             </div>
             <button type="button" className="feedback-widget__close" onClick={() => setOpen(false)}>
              Close
            </button>
          </div>

          <form className="feedback-widget__form" onSubmit={handleSubmit}>
            <label className="feedback-widget__field">
              <span className="feedback-widget__label">Your feedback</span>
              <textarea
                ref={textareaRef}
                rows={5}
                value={feedbackText}
                onChange={(event) => setFeedbackText(event.target.value)}
                placeholder="Describe the issue, suggestion, or moment that felt awkward."
                className="feedback-widget__textarea"
                maxLength={5000}
                aria-describedby="feedback-text-hint"
                required
              />
            </label>
            <p id="feedback-text-hint" className="feedback-widget__hint">
              Up to 5000 characters.
            </p>

            <div className="feedback-widget__field">
              <span className="feedback-widget__label">Selected element</span>
              <div className="feedback-widget__selection">
                <button
                  type="button"
                  className={`feedback-widget__selector ${selecting ? 'is-selecting' : ''}`}
                  onClick={() => setSelecting((current) => !current)}
                  aria-pressed={selecting}
                  aria-describedby="feedback-selection-hint"
                >
                  {selecting ? 'Selecting… click any page element' : selectionLabel}
                </button>
                {selectedElement ? (
                  <button type="button" className="feedback-widget__clear" onClick={clearSelection}>
                    Clear
                  </button>
                ) : null}
              </div>
              <p id="feedback-selection-hint" className="feedback-widget__hint">
                Choose a specific heading, card, or button if the feedback is location-specific.
              </p>
            </div>

            <div className="feedback-widget__actions">
              <button type="submit" className="feedback-widget__submit" disabled={!canSubmit}>
                Submit
              </button>
              <button type="button" className="feedback-widget__cancel" onClick={() => setOpen(false)}>
                Cancel
              </button>
            </div>
          </form>

          {submission.kind !== 'idle' ? (
            <p
              className={`feedback-widget__status feedback-widget__status--${submission.kind}`}
              role={submission.kind === 'error' ? 'alert' : 'status'}
              aria-live="polite"
            >
              {submission.message}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
