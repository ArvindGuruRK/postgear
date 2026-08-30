'use client';

// Lightweight external-store toast queue (the standard shadcn pattern) — lets
// `toast()` be called from anywhere (event handlers, non-component code)
// while `useToast()` subscribes components to the current queue.
import * as React from 'react';
import type { ToastActionElement, ToastProps } from '../components/toast';

const TOAST_LIMIT = 3;
// Just past toastSlideOut's 0.2s exit animation (see tailwind.css) — long
// enough for the close animation to finish, short enough that a just-closed
// toast stops occupying a stack slot almost immediately. Used to sit at
// 5000ms, which let closed-but-not-yet-removed toasts count against
// TOAST_LIMIT and bump still-open ones out of the array early.
const TOAST_REMOVE_DELAY = 300;

type ToasterToast = ToastProps & {
  id: string;
  title?: React.ReactNode;
  description?: React.ReactNode;
  action?: ToastActionElement;
};

type Action =
  | { type: 'ADD_TOAST'; toast: ToasterToast }
  | { type: 'DISMISS_TOAST'; toastId?: string }
  | { type: 'REMOVE_TOAST'; toastId?: string };

let count = 0;
function genId() {
  count = (count + 1) % Number.MAX_SAFE_INTEGER;
  return count.toString();
}

interface State {
  toasts: ToasterToast[];
}

const listeners: Array<(state: State) => void> = [];
let memoryState: State = { toasts: [] };

const timeouts = new Map<string, ReturnType<typeof setTimeout>>();

function scheduleRemoval(toastId: string) {
  if (timeouts.has(toastId)) return;
  const timeout = setTimeout(() => {
    timeouts.delete(toastId);
    dispatch({ type: 'REMOVE_TOAST', toastId });
  }, TOAST_REMOVE_DELAY);
  timeouts.set(toastId, timeout);
}

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'ADD_TOAST':
      return { toasts: [action.toast, ...state.toasts].slice(0, TOAST_LIMIT) };
    case 'DISMISS_TOAST': {
      if (action.toastId) scheduleRemoval(action.toastId);
      else
        state.toasts.forEach((t) => {
          scheduleRemoval(t.id);
        });
      return {
        toasts: state.toasts.map((t) =>
          t.id === action.toastId || action.toastId === undefined ? { ...t, open: false } : t,
        ),
      };
    }
    case 'REMOVE_TOAST':
      if (action.toastId === undefined) return { toasts: [] };
      return { toasts: state.toasts.filter((t) => t.id !== action.toastId) };
  }
}

function dispatch(action: Action) {
  memoryState = reducer(memoryState, action);
  listeners.forEach((listener) => {
    listener(memoryState);
  });
}

type Toast = Omit<ToasterToast, 'id'>;

export function toast({ ...props }: Toast) {
  const id = genId();

  const update = (next: Toast) => dispatch({ type: 'ADD_TOAST', toast: { ...next, id, open: true } });
  const dismiss = () => dispatch({ type: 'DISMISS_TOAST', toastId: id });

  dispatch({
    type: 'ADD_TOAST',
    toast: {
      ...props,
      id,
      open: true,
      onOpenChange: (open: boolean) => {
        if (!open) dismiss();
      },
    },
  });

  return { id, dismiss, update };
}

export function useToast() {
  const [state, setState] = React.useState<State>(memoryState);

  React.useEffect(() => {
    listeners.push(setState);
    return () => {
      const index = listeners.indexOf(setState);
      if (index > -1) listeners.splice(index, 1);
    };
  }, []);

  return {
    ...state,
    toast,
    dismiss: (toastId?: string) => dispatch({ type: 'DISMISS_TOAST', toastId }),
  };
}
