'use client';

import { useToast } from '../hooks/use-toast';
import { cn } from '../lib/utils';
import {
  Toast,
  ToastClose,
  ToastDescription,
  ToastProvider,
  ToastTitle,
  ToastViewport,
} from './toast';

const MAX_VISIBLE_DEPTH = 2;

export function Toaster() {
  const { toasts } = useToast();
  const openIds = toasts.filter((t) => t.open !== false).map((t) => t.id);

  return (
    <ToastProvider>
      {toasts.map(({ id, title, description, action, open, ...props }) => {
        const openIndex = openIds.indexOf(id);
        const isOpen = openIndex !== -1;
        const depth = Math.min(isOpen ? openIndex : 0, MAX_VISIBLE_DEPTH);

        return (
          <Toast
            key={id}
            open={open}
            className={cn(depth > 0 && 'pointer-events-none')}
            style={
              isOpen
                ? {
                    zIndex: 50 - depth,
                    transform: `translateY(${depth * -12}px) scale(${1 - depth * 0.06})`,
                    opacity: 1 - depth * 0.12,
                  }
                : undefined
            }
            {...props}
          >
            <div className="flex flex-col gap-1">
              {title ? <ToastTitle>{title}</ToastTitle> : null}
              {description ? <ToastDescription>{description}</ToastDescription> : null}
            </div>
            {action ?? <ToastClose />}
          </Toast>
        );
      })}
      <ToastViewport />
    </ToastProvider>
  );
}
