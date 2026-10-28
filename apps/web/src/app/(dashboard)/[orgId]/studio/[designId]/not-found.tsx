import { DesignMissingHere } from '@/components/studio/design-missing';

/**
 * A design that is not there (deleted, never real, or another workspace's,
 * which the API answers alike): the page calls `notFound()`, and this shows
 * inside the workspace's shell, with the same warning and way back to Studio
 * the editor shows when its own load finds the design gone. Sent as a real
 * 404; Next adds `noindex`.
 */
export default function DesignNotFound() {
  return <DesignMissingHere />;
}
