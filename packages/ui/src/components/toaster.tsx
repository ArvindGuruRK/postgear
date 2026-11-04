'use client';

import { CircleX, TriangleAlert } from 'lucide-react';
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
      {toasts.map(({ id, title, description, action, open, variant, ...props }) => {
        const openIndex = openIds.indexOf(id);
        const isOpen = openIndex !== -1;
        const depth = Math.min(isOpen ? openIndex : 0, MAX_VISIBLE_DEPTH);

        return (
          <Toast
            key={id}
            open={open}
            variant={variant}
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
            {variant === 'warning' ? (
              <TriangleAlert aria-hidden="true" className="h-5 w-5 shrink-0" strokeWidth={2.5} />
            ) : variant === 'danger' ? (
              <CircleX aria-hidden="true" className="h-5 w-5 shrink-0" strokeWidth={2.5} />
            ) : null}
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <div className="flex flex-col gap-1">
                {title ? <ToastTitle>{title}</ToastTitle> : null}
                {description ? <ToastDescription>{description}</ToastDescription> : null}
              </div>
              {action ? <div className="flex">{action}</div> : null}
            </div>
            <ToastClose />
          </Toast>
        );
      })}
      <ToastViewport />
    </ToastProvider>
  );
}
