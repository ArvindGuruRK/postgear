/**
 * What the billing page says when billing is off.
 *
 * `/billing/status` answers `mode: 'unconfigured'` when neither a Stripe
 * key nor simulation is set; checkout and the portal would answer 503.
 * The plans and the trial still render below this (the trial needs no
 * Stripe), so this is an explanation at the top, not a replacement for
 * the page — and it names the two ways out, the same two the AI studio
 * names for its own unconfigured state.
 */
import { Alert, AlertDescription, AlertTitle, Text } from '@postgear/ui';

export function BillingUnconfigured() {
  return (
    <Alert variant="warning" data-testid="billing-unconfigured" className="flex-col gap-3">
      <div className="flex flex-col gap-1">
        <AlertTitle>Payments aren’t set up on this PostGear instance</AlertTitle>
        <AlertDescription>
          You can start a free trial, but subscribing and the billing portal are off until one of
          these is set in the API’s environment and it is restarted.
        </AlertDescription>
      </div>
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        <li className="rounded-md border-2 border-outline bg-secondary p-3">
          <code className="font-sans text-sm font-bold text-ink">
            STRIPE_SECRET_KEY + STRIPE_WEBHOOK_SECRET
          </code>
          <Text size="sm" muted>
            Real Stripe keys (test mode is free). Checkout, the portal and the webhook go to Stripe.
          </Text>
        </li>
        <li className="rounded-md border-2 border-outline bg-secondary p-3">
          <code className="font-sans text-sm font-bold text-ink">BILLING_SIMULATION="true"</code>
          <Text size="sm" muted>
            A local stand-in: no card, no Stripe, every screen and the webhook handler still run.
            Refused in production.
          </Text>
        </li>
      </ul>
    </Alert>
  );
}
