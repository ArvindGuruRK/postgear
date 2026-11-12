/**
 * The building blocks every PostGear email is made of.
 *
 * Email HTML is its own dialect: tables for layout (Outlook's Word engine
 * understands nothing else), inline styles (Gmail drops most of a <style>),
 * no box-shadow (Gmail and Outlook ignore it). So the neobrutalist hard
 * shadow is built from table cells: an ink column down the right and an ink
 * row along the bottom, each with a notch of page colour at its start, which
 * is exactly what a 6px offset shadow looks like.
 *
 * Class names (`pg-*`) are only hooks for the dark-mode and small-screen rules
 * in the document head (render.ts); every style that matters is inline.
 */
import type { CSSProperties, ReactNode } from 'react';
import { COLORS, FONT_STACK, MONO_STACK, SHADOW, TONE_FILL, type Tone } from './brand';
import { escapeHtml } from './safe';

const NBSP = ' ';

/** A layout table: no spacing, no border, and announced as nothing to screen readers. */
export function Table({
  children,
  width = '100%',
  style,
  className,
  align,
}: {
  children: ReactNode;
  /** `null` leaves the table as wide as its content. */
  width?: string | number | null;
  style?: CSSProperties;
  className?: string;
  align?: 'center' | 'left';
}) {
  return (
    <table
      role="presentation"
      cellPadding={0}
      cellSpacing={0}
      border={0}
      width={width ?? undefined}
      align={align}
      className={className}
      style={
        {
          borderCollapse: 'separate',
          msoTableLspace: '0pt',
          msoTableRspace: '0pt',
          ...style,
        } as CSSProperties
      }
    >
      <tbody>{children}</tbody>
    </table>
  );
}

/** A cell that only holds space (spacers, shadow notches). */
function Spacer({
  width,
  height,
  className,
  color,
}: {
  width?: number;
  height: number;
  className?: string;
  color: string;
}) {
  return (
    <td
      width={width}
      height={height}
      className={className}
      style={{
        width: width ? `${width}px` : undefined,
        height: `${height}px`,
        lineHeight: `${height}px`,
        fontSize: 0,
        backgroundColor: color,
        padding: 0,
      }}
    >
      {NBSP}
    </td>
  );
}

/**
 * A box with a 3px ink border and a hard ink shadow `offset` px down and right.
 * `gap` is the colour behind the box (the page, or the card for a box inside
 * the card), and `gapClass` is the class that recolours it in dark mode.
 */
export function ShadowBox({
  children,
  offset = SHADOW.card,
  gap,
  gapClass,
  fill = COLORS.white,
  fillClass = 'pg-card',
}: {
  children: ReactNode;
  offset?: number;
  gap: string;
  gapClass: string;
  fill?: string;
  fillClass?: string;
}) {
  return (
    <Table>
      <tr>
        <td
          className={`${fillClass} pg-border`}
          style={{
            backgroundColor: fill,
            border: `3px solid ${COLORS.ink}`,
            padding: 0,
            verticalAlign: 'top',
          }}
        >
          {children}
        </td>
        <td
          width={offset}
          className="pg-shadow"
          style={{
            width: `${offset}px`,
            backgroundColor: COLORS.ink,
            verticalAlign: 'top',
            padding: 0,
          }}
        >
          <Table width={offset}>
            <tr>
              <Spacer width={offset} height={offset} className={gapClass} color={gap} />
            </tr>
          </Table>
        </td>
      </tr>
      <tr>
        <td style={{ padding: 0 }}>
          <Table>
            <tr>
              <Spacer width={offset} height={offset} className={gapClass} color={gap} />
              <Spacer height={offset} className="pg-shadow" color={COLORS.ink} />
            </tr>
          </Table>
        </td>
        <Spacer width={offset} height={offset} className="pg-shadow" color={COLORS.ink} />
      </tr>
    </Table>
  );
}

const textBase: CSSProperties = {
  fontFamily: FONT_STACK,
  color: COLORS.ink,
  margin: 0,
};

/** The coloured top of the card: a sticker badge and the big heading. */
export function Hero({ tone, badge, heading }: { tone: Tone; badge: string; heading: string }) {
  const fill = TONE_FILL[tone];
  return (
    <Table>
      <tr>
        <td
          className="pg-px pg-hero"
          style={{
            backgroundColor: fill,
            // Gmail's app recolours flat backgrounds in dark mode but leaves
            // images alone, and a one-colour gradient counts as an image.
            backgroundImage: `linear-gradient(${fill}, ${fill})`,
            padding: '34px 40px 30px',
            borderBottom: `3px solid ${COLORS.ink}`,
          }}
        >
          <span
            style={{
              display: 'inline-block',
              backgroundColor: COLORS.white,
              border: `2px solid ${COLORS.ink}`,
              padding: '5px 11px',
              fontFamily: FONT_STACK,
              fontSize: '13px',
              lineHeight: '16px',
              fontWeight: 700,
              color: COLORS.ink,
            }}
          >
            {badge}
          </span>
          <h1
            className="pg-h1"
            style={{
              ...textBase,
              color: COLORS.white,
              fontSize: '34px',
              lineHeight: '40px',
              fontWeight: 800,
              letterSpacing: '-0.5px',
              marginTop: '18px',
            }}
          >
            {heading}
          </h1>
        </td>
      </tr>
      <tr>
        {/* The yellow tape under the band: PostGear's signature colour. */}
        <td
          height={10}
          style={{
            height: '10px',
            lineHeight: '10px',
            fontSize: 0,
            backgroundColor: COLORS.yellow,
            backgroundImage: `linear-gradient(${COLORS.yellow}, ${COLORS.yellow})`,
            borderBottom: `3px solid ${COLORS.ink}`,
          }}
        >
          {NBSP}
        </td>
      </tr>
    </Table>
  );
}

/** One paragraph. A line that is nothing but a link becomes a clickable link. */
export function Paragraph({
  text,
  muted = false,
  small = false,
}: {
  text: string;
  muted?: boolean;
  small?: boolean;
}) {
  const lines = text.split('\n');
  return (
    <p
      className={muted ? 'pg-muted' : 'pg-text'}
      style={{
        ...textBase,
        color: muted ? COLORS.muted : COLORS.ink,
        fontSize: small ? '14px' : '16px',
        lineHeight: small ? '22px' : '26px',
        margin: '0 0 16px',
        wordBreak: 'break-word',
      }}
    >
      {lines.map((line, index) => {
        const link = /^https?:\/\/\S+$/i.test(line) ? line : null;
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: static lines, never reordered.
          <span key={index}>
            {index > 0 ? <br /> : null}
            {link ? (
              <a
                href={link}
                className="pg-link"
                style={{ color: COLORS.blue, textDecoration: 'underline', wordBreak: 'break-all' }}
              >
                {link}
              </a>
            ) : (
              line
            )}
          </span>
        );
      })}
    </p>
  );
}

/**
 * The one call to action: a blue block with an ink border and a hard shadow,
 * and a VML rectangle for Outlook on Windows, which cannot draw a padded link.
 * Written as raw HTML because React cannot emit Outlook's conditional
 * comments; both inputs are escaped here and the label is always ours.
 */
export function Button({ label, url }: { label: string; url: string }) {
  const href = escapeHtml(url);
  const text = escapeHtml(label);
  const width = Math.max(200, Math.round(label.length * 10.5 + 64));
  const o = SHADOW.button;
  const gap = `<td width="${o}" height="${o}" class="pg-card" style="width:${o}px;height:${o}px;line-height:${o}px;font-size:0;background-color:${COLORS.white};padding:0;">&nbsp;</td>`;
  const ink = (width?: number) =>
    `<td${width ? ` width="${width}"` : ''} height="${o}" class="pg-shadow" style="${width ? `width:${width}px;` : ''}height:${o}px;line-height:${o}px;font-size:0;background-color:${COLORS.ink};padding:0;">&nbsp;</td>`;
  const table = (rows: string, extra = '') =>
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0"${extra} style="border-collapse:separate;">${rows}</table>`;

  const html = [
    '<!--[if mso]>',
    `<v:rect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${href}" style="height:54px;v-text-anchor:middle;width:${width}px;" strokecolor="${COLORS.ink}" strokeweight="3px" fillcolor="${COLORS.blue}"><w:anchorlock/><center style="color:#ffffff;font-family:Arial,sans-serif;font-size:17px;font-weight:bold;">${text}</center></v:rect>`,
    '<![endif]-->',
    '<!--[if !mso]><!-->',
    table(
      [
        '<tr>',
        `<td class="pg-btn" style="background-color:${COLORS.blue};background-image:linear-gradient(${COLORS.blue},${COLORS.blue});border:3px solid ${COLORS.ink};padding:0;">`,
        `<a href="${href}" target="_blank" rel="noopener" style="display:inline-block;padding:15px 30px;font-family:${escapeHtml(FONT_STACK)};font-size:17px;line-height:20px;font-weight:700;color:#ffffff;text-decoration:none;">${text}</a>`,
        '</td>',
        `<td width="${o}" class="pg-shadow" style="width:${o}px;background-color:${COLORS.ink};vertical-align:top;padding:0;">${table(`<tr>${gap}</tr>`)}</td>`,
        '</tr>',
        '<tr>',
        `<td style="padding:0;">${table(`<tr>${gap}${ink()}</tr>`, ' width="100%"')}</td>`,
        ink(o),
        '</tr>',
      ].join(''),
    ),
    '<!--<![endif]-->',
  ].join('');

  return (
    <div
      style={{ margin: '8px 0 24px' }}
      // biome-ignore lint/security/noDangerouslySetInnerHtml: Outlook's conditional comments need raw HTML; every value in it is escaped above.
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

/** The raw link under the button, for when the button does not work. */
export function LinkFallback({ url }: { url: string }) {
  return (
    <p
      className="pg-muted"
      style={{
        ...textBase,
        color: COLORS.muted,
        fontSize: '13px',
        lineHeight: '20px',
        margin: '0 0 20px',
      }}
    >
      Button not working? Paste this link into your browser:
      <br />
      <a
        href={url}
        className="pg-link"
        style={{
          color: COLORS.blue,
          fontFamily: MONO_STACK,
          fontSize: '12px',
          lineHeight: '18px',
          wordBreak: 'break-all',
          textDecoration: 'underline',
        }}
      >
        {url}
      </a>
    </p>
  );
}

export interface Fact {
  label: string;
  value: string;
  /** Shows the value as a squared badge (a role, a plan). */
  badge?: boolean;
}

/** The summary card: the key facts as label and value rows. */
export function FactCard({ facts }: { facts: Fact[] }) {
  return (
    <div style={{ margin: '4px 0 24px' }}>
      <Table
        className="pg-inset pg-border"
        style={{ backgroundColor: COLORS.inset, border: `2px solid ${COLORS.ink}` }}
      >
        {facts.map((fact, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: static rows rendered once to a string, never reordered.
          <tr key={index}>
            <td
              width="36%"
              className="pg-muted pg-row"
              style={{
                ...textBase,
                color: COLORS.muted,
                fontSize: '13px',
                lineHeight: '20px',
                fontWeight: 600,
                padding: '12px 14px 12px 16px',
                verticalAlign: 'top',
                borderTop: index > 0 ? '1px solid #ded5bf' : 'none',
              }}
            >
              {fact.label}
            </td>
            <td
              className="pg-text pg-row"
              style={{
                ...textBase,
                fontSize: '15px',
                lineHeight: '22px',
                fontWeight: 600,
                padding: '11px 16px 11px 0',
                verticalAlign: 'top',
                wordBreak: 'break-word',
                borderTop: index > 0 ? '1px solid #ded5bf' : 'none',
              }}
            >
              {fact.badge ? (
                <span
                  style={{
                    display: 'inline-block',
                    backgroundColor: COLORS.yellow,
                    border: `2px solid ${COLORS.ink}`,
                    padding: '1px 8px',
                    color: COLORS.ink,
                    fontSize: '13px',
                    lineHeight: '18px',
                    fontWeight: 700,
                  }}
                >
                  {fact.value}
                </span>
              ) : (
                fact.value
              )}
            </td>
          </tr>
        ))}
      </Table>
    </div>
  );
}

/** A short list (Discover highlights), as real list items. */
export function BulletList({ items }: { items: string[] }) {
  return (
    <ul style={{ margin: '0 0 20px', padding: '0 0 0 20px' }}>
      {items.map((item, index) => (
        <li
          // biome-ignore lint/suspicious/noArrayIndexKey: static items, never reordered.
          key={index}
          className="pg-text"
          style={{
            ...textBase,
            fontSize: '15px',
            lineHeight: '24px',
            margin: '0 0 8px',
            wordBreak: 'break-word',
          }}
        >
          {item}
        </li>
      ))}
    </ul>
  );
}

/** Text someone else wrote (cancellation feedback), set apart and labelled. */
export function Quote({ label, text }: { label: string; text: string }) {
  return (
    <div style={{ margin: '0 0 24px' }}>
      <p
        className="pg-muted"
        style={{
          ...textBase,
          color: COLORS.muted,
          fontSize: '13px',
          lineHeight: '20px',
          fontWeight: 600,
          margin: '0 0 6px',
        }}
      >
        {label}
      </p>
      <Table
        className="pg-inset"
        style={{ backgroundColor: COLORS.inset, borderLeft: `5px solid ${COLORS.yellow}` }}
      >
        <tr>
          <td
            className="pg-text"
            style={{
              ...textBase,
              fontSize: '15px',
              lineHeight: '24px',
              padding: '12px 16px',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}
          >
            {text}
          </td>
        </tr>
      </Table>
    </div>
  );
}

/** The calm note at the end (security mail): who to ignore it for, what did not change. */
export function Note({ text }: { text: string }) {
  return (
    <Table
      className="pg-inset"
      style={{ backgroundColor: COLORS.inset, borderLeft: `5px solid ${COLORS.ink}` }}
    >
      <tr>
        <td
          className="pg-muted pg-note"
          style={{
            ...textBase,
            color: COLORS.muted,
            fontSize: '14px',
            lineHeight: '22px',
            padding: '12px 16px',
          }}
        >
          {text}
        </td>
      </tr>
    </Table>
  );
}
