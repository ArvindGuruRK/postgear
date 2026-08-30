import { forwardRef } from 'react';
import { cn } from '../lib/utils';
import { Label } from './label';

export const FormField = forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('flex flex-col gap-2', className)} {...props} />
  ),
);
FormField.displayName = 'FormField';

export interface FormLabelProps extends React.ComponentPropsWithoutRef<typeof Label> {
  required?: boolean;
}

export const FormLabel = forwardRef<React.ElementRef<typeof Label>, FormLabelProps>(
  ({ className, required, children, ...props }, ref) => (
    <Label ref={ref} className={className} {...props}>
      {children}
      {required && <span className="ml-1 text-actionDanger">*</span>}
    </Label>
  ),
);
FormLabel.displayName = 'FormLabel';

export const FormHelperText = forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <p ref={ref} className={cn('font-sans text-xs text-ink opacity-70', className)} {...props} />
));
FormHelperText.displayName = 'FormHelperText';

export const FormErrorMessage = forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <p
    ref={ref}
    role="alert"
    className={cn('font-sans text-xs font-semibold text-actionDanger', className)}
    {...props}
  />
));
FormErrorMessage.displayName = 'FormErrorMessage';
