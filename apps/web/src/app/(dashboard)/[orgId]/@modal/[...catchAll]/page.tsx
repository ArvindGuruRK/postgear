/**
 * Closes the modal slot on any other in-app navigation.
 *
 * A parallel slot keeps showing what it last matched while the rest of the
 * page navigates, so without this, following a link out of the composer
 * modal (to Channels, say) would leave the composer open over the new page.
 * Every route that is not the composer matches here and renders nothing.
 */
export default function ModalCatchAll() {
  return null;
}
