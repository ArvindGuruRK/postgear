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
          // Every step as wide as the next, so a connector (this step's width,
          // from its centre) ends exactly at the next step's centre.
          <li key={step.label} className="relative flex flex-1 flex-col items-center gap-2">
            <div
              aria-current={isActive ? 'step' : undefined}
              className={cn(
                'relative z-10 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 border-outline type-ui text-sm',
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
            {/* Below `sm` only the current step is labelled (the rest stay in
                the accessibility tree): six uppercase labels do not fit side by
                side on a phone and ran into each other. */}
            <div className={cn('flex flex-col items-center text-center', !isActive && 'max-sm:sr-only')}>
              <span className="type-label text-xs text-ink">{step.label}</span>
              {step.description && (
                <span className="font-sans text-xs font-medium text-ink opacity-60 max-sm:hidden">
                  {step.description}
                </span>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
