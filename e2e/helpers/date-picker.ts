import { expect, type Locator, type Page } from '@playwright/test';

/**
 * Drives the design system's calendar pickers (DatePicker, DateTimePicker) the
 * way a person does: open the trigger, page the calendar to the month, click
 * the day, then the hour, minute and AM / PM keys. Each trigger carries its
 * exact local value in `data-value`, which is what the helpers assert.
 */

const pad = (value: number) => String(value).padStart(2, '0');

export function localDay(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function localDateTime(date: Date): string {
  return `${localDay(date)}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** The open picker: Radix portals it into a popper wrapper outside any dialog. */
function popover(page: Page): Locator {
  return page.locator('[data-radix-popper-content-wrapper]').last();
}

/** Pages the open calendar to the date's month and clicks its day. */
async function clickDay(page: Page, date: Date) {
  const panel = popover(page);
  const key = localDay(date);
  const day = panel.locator(`td[data-day="${key}"]:not([data-outside])`);

  for (let step = 0; step < 36 && !(await day.isVisible()); step += 1) {
    const shown = await panel
      .locator('td[data-day]:not([data-outside])')
      .first()
      .getAttribute('data-day');
    const forward = (shown ?? '') < key;
    await panel.getByRole('button', { name: forward ? /next month/i : /previous month/i }).click();
  }

  await day.getByRole('button').click();
}

/** Picks a day in a DatePicker; choosing a day closes it. */
export async function pickDate(page: Page, trigger: Locator, date: Date) {
  await trigger.click();
  await clickDay(page, date);
  await expect(trigger).toHaveAttribute('data-value', localDay(date));
}

/** Picks a day and a time in a DateTimePicker, then presses Done. */
export async function pickDateTime(page: Page, trigger: Locator, date: Date) {
  await trigger.click();
  await clickDay(page, date);

  const panel = popover(page);
  const twelveHour = (await panel.getByRole('group', { name: 'AM or PM' }).count()) > 0;
  const hours = date.getHours();
  const hourText = twelveHour ? String(hours % 12 || 12) : pad(hours);

  await panel
    .getByRole('group', { name: 'Hour' })
    .getByRole('button', { name: hourText, exact: true })
    .click();
  await panel
    .getByRole('group', { name: 'Minute' })
    .getByRole('button', { name: pad(date.getMinutes()), exact: true })
    .click();
  if (twelveHour) {
    await panel
      .getByRole('group', { name: 'AM or PM' })
      .getByRole('button', { name: hours >= 12 ? 'PM' : 'AM', exact: true })
      .click();
  }

  await panel.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(panel).toBeHidden();
  await expect(trigger).toHaveAttribute('data-value', localDateTime(date));
}
