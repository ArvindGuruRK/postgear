import { Check } from 'lucide-react';
import { cn } from '../lib/utils';

export interface StepperStep {
  label: string;
  description?: string;
}

export interface OnboardingStepperProps extends React.HTMLAttributes<HTMLOListElement> {
  steps: StepperStep[];
  currentStep: number;
}

export function OnboardingStepper({ className, steps, currentStep, ...props }: OnboardingStepperProps) {
  return (
    <ol className={cn('flex w-full items-start', className)} {...props}>
      {steps.map((step, index) => {
        const stepNumber = index + 1;
        const isComplete = stepNumber < currentStep;
        const isActive = stepNumber === currentStep;
        const isLast = index === steps.length - 1;

        return (
          <li key={step.label} className="relative flex flex-1 flex-col items-center gap-2 last:flex-none">
            <div
              aria-current={isActive ? 'step' : undefined}
              className={cn(
                'relative z-10 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 border-outline font-display text-sm',
                isComplete || isActive
                  ? 'bg-actionPrimary text-onActionPrimary'
                  : 'bg-secondary text-ink/60',
              )}
            >
              {isComplete ? <Check className="h-4 w-4" strokeWidth={3} /> : stepNumber}
            </div>
            {!isLast && (
              <div
                className={cn(
                  'absolute left-1/2 top-[17px] h-0.5 w-full',
                  isComplete ? 'bg-actionPrimary' : 'bg-outline opacity-30',
                )}
              />
            )}
            <div className="flex flex-col items-center text-center">
              <span className="font-display text-xs uppercase tracking-wide text-ink">{step.label}</span>
              {step.description && <span className="font-sans text-xs font-medium text-ink opacity-60">{step.description}</span>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
