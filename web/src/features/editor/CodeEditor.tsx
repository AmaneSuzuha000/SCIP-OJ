import { useEffect, useRef } from 'react';
import { Compartment, EditorState } from '@codemirror/state';
import {
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
} from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { python } from '@codemirror/lang-python';
import { oneDark } from '@codemirror/theme-one-dark';
import { useTheme } from '@/store/theme';

interface CodeEditorProps {
  value: string;
  onChange: (next: string) => void;
  readOnly?: boolean;
  ariaLabel?: string;
  blockPaste?: boolean;
  onSignal?: (kind: 'input' | 'paste' | 'blocked_paste' | 'copy' | 'drop') => void;
}

/** CodeMirror 6 wrapper. Created once; external value changes are reconciled
 *  without recreating the view so cursor and undo history survive re-renders. */
export function CodeEditor({
  value,
  onChange,
  readOnly = false,
  ariaLabel,
  blockPaste = false,
  onSignal,
}: CodeEditorProps) {
  const host = useRef<HTMLDivElement | null>(null);
  const view = useRef<EditorView | null>(null);
  const themeSlot = useRef(new Compartment());
  const readOnlySlot = useRef(new Compartment());
  const onChangeRef = useRef(onChange);
  const onSignalRef = useRef(onSignal);
  const blockPasteRef = useRef(blockPaste);
  // Read resolved ('light' | 'dark') so system preference switches update CodeMirror cleanly.
  const resolvedTheme = useTheme((state) => state.resolved);

  onChangeRef.current = onChange;
  onSignalRef.current = onSignal;
  blockPasteRef.current = blockPaste;

  useEffect(() => {
    if (!host.current) return;
    const state = EditorState.create({
      doc: value,
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightActiveLine(),
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
        python(),
        EditorView.lineWrapping,
        themeSlot.current.of(resolvedTheme === 'dark' ? oneDark : []),
        readOnlySlot.current.of(EditorState.readOnly.of(readOnly)),
        EditorView.domEventHandlers({
          paste: (event) => {
            if (blockPasteRef.current) {
              event.preventDefault();
              onSignalRef.current?.('blocked_paste');
              return true;
            }
            onSignalRef.current?.('paste');
            return false;
          },
          copy: () => {
            onSignalRef.current?.('copy');
            return false;
          },
          drop: (event) => {
            if (blockPasteRef.current) {
              event.preventDefault();
              onSignalRef.current?.('blocked_paste');
              return true;
            }
            onSignalRef.current?.('drop');
            return false;
          },
        }),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            onChangeRef.current(update.state.doc.toString());
            if (update.transactions.some((tr) => tr.isUserEvent('input'))) {
              onSignalRef.current?.('input');
            }
          }
        }),
        EditorView.theme({
          '&': { fontSize: '13px', minHeight: '320px' },
          '.cm-scroller': { fontFamily: 'var(--font-mono)' },
        }),
      ],
    });
    const instance = new EditorView({ state, parent: host.current });
    view.current = instance;
    return () => {
      instance.destroy();
      view.current = null;
    };
    // Mount once; theme and value are reconciled by the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    view.current?.dispatch({
      effects: themeSlot.current.reconfigure(resolvedTheme === 'dark' ? oneDark : []),
    });
  }, [resolvedTheme]);

  useEffect(() => {
    view.current?.dispatch({
      effects: readOnlySlot.current.reconfigure(EditorState.readOnly.of(readOnly)),
    });
  }, [readOnly]);

  useEffect(() => {
    const instance = view.current;
    if (!instance) return;
    const current = instance.state.doc.toString();
    if (current !== value) {
      instance.dispatch({
        changes: { from: 0, to: current.length, insert: value },
      });
    }
  }, [value]);

  return (
    <div
      ref={host}
      role="textbox"
      aria-label={ariaLabel ?? '代码编辑器'}
      aria-multiline="true"
      className="overflow-hidden rounded-[var(--radius-md)] border border-subtle bg-surface"
    />
  );
}
