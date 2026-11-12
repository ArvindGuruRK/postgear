/**
 * One email, from a spec to `{ subject, preview, html, text }`.
 *
 * Every template fills an `EmailSpec` (what the email says), and this file
 * decides how it looks: the logo, the card with its colour band, the button,
 * the facts, the footer. The plain-text part is written from the same spec,
 * so the two can never disagree.
 *
 * Rendered with `react-dom/server`, which React escapes as it goes: nothing a
 * template passes in as text can become markup.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { ASSET_PATHS, COLORS, CONTENT_WIDTH, DARK, FONT_STACK, type Tone } from './brand';
import {
  BulletList,
  Button,
  type Fact,
  FactCard,
  Hero,
  LinkFallback,
  Note,
  Paragraph,
  Quote,
  ShadowBox,
  Table,
} from './components';
import { escapeHtml, LIMITS, oneLine, safeUrl } from './safe';

/** Where the email is sent from: the web app's address, for links and images. */
export interface EmailContext {
  webUrl: string;
}

export interface EmailSpec {
  subject: string;
  /** The grey line inbox lists show after the subject. */
  preview: string;
  tone: Tone;
  /** A short Title Case label on the band ("Security", "Invitation"). */
  badge: string;
  heading: string;
  /** Paragraphs above the facts and the button. */
  intro: string[];
  facts?: Fact[];
  bullets?: string[];
  quote?: { label: string; text: string };
  /** The one button. Without a safe http(s) URL there is no button. */
  action?: { label: string; url: string };
  /** Paragraphs below the button. */
  after?: string[];
  /** The calm note at the end (security mail). */
  note?: string;
  footer: {
    /** Why this person got this email, as a sentence. */
    reason: string;
    settings?: { label: string; url: string };
  };
}

export interface RenderedEmail {
  subject: string;
  preview: string;
  html: string;
  text: string;
}

export function renderEmail(context: EmailContext, spec: EmailSpec): RenderedEmail {
  const webUrl = (safeUrl(context.webUrl) ?? 'http://localhost:3000').replace(/\/+$/, '');
  const subject = oneLine(spec.subject, LIMITS.subject);
  const preview = oneLine(spec.preview, LIMITS.preview);
  const actionUrl = spec.action ? safeUrl(spec.action.url) : null;
  const action = spec.action && actionUrl ? { label: spec.action.label, url: actionUrl } : null;
  const settingsUrl = spec.footer.settings ? safeUrl(spec.footer.settings.url) : null;

  // React 19 adds a `<link rel="preload">` for every image it renders, which
  // means nothing in an inbox and some clients show as junk; they go.
  const body = renderToStaticMarkup(
    <Layout webUrl={webUrl} spec={spec} action={action} settingsUrl={settingsUrl} />,
  ).replace(/<link rel="preload" as="image"[^>]*\/>/g, '');

  return {
    subject,
    preview,
    html: documentHtml({ title: subject, preview, body }),
    text: plainText(webUrl, spec, action, settingsUrl),
  };
}

function Layout({
  webUrl,
  spec,
  action,
  settingsUrl,
}: {
  webUrl: string;
  spec: EmailSpec;
  action: { label: string; url: string } | null;
  settingsUrl: string | null;
}) {
  const host = webUrl.replace(/^https?:\/\//, '');
  return (
    <Table className="pg-page" style={{ backgroundColor: COLORS.cream }}>
      <tr>
        <td align="center" className="pg-outer" style={{ padding: '32px 16px 40px' }}>
          <Table
            width={CONTENT_WIDTH}
            className="pg-container"
            style={{ width: '100%', maxWidth: `${CONTENT_WIDTH}px` }}
          >
            {/* The logo: the Version 5 gear and the name. */}
            <tr>
              <td style={{ padding: '0 0 22px' }}>
                <Table width={null}>
                  <tr>
                    <td style={{ verticalAlign: 'middle', paddingRight: '12px' }}>
                      <a href={webUrl} style={{ textDecoration: 'none' }}>
                        <img
                          src={`${webUrl}${ASSET_PATHS.gear}`}
                          width={44}
                          height={44}
                          alt="PostGear"
                          style={{
                            display: 'block',
                            border: 0,
                            outline: 'none',
                            width: '44px',
                            height: '44px',
                          }}
                        />
                      </a>
                    </td>
                    <td
                      className="pg-text"
                      style={{
                        verticalAlign: 'middle',
                        fontFamily: FONT_STACK,
                        fontSize: '24px',
                        lineHeight: '28px',
                        fontWeight: 800,
                        letterSpacing: '-0.3px',
                        color: COLORS.ink,
                      }}
                    >
                      PostGear
                    </td>
                  </tr>
                </Table>
              </td>
            </tr>

            {/* The card. */}
            <tr>
              <td>
                <ShadowBox gap={COLORS.cream} gapClass="pg-page">
                  <Hero tone={spec.tone} badge={spec.badge} heading={spec.heading} />
                  <Table>
                    <tr>
                      <td className="pg-px" style={{ padding: '32px 40px 30px' }}>
                        {spec.intro.map((text, index) => (
                          // biome-ignore lint/suspicious/noArrayIndexKey: static paragraphs.
                          <Paragraph key={index} text={text} />
                        ))}
                        {spec.facts && spec.facts.length > 0 ? (
                          <FactCard facts={spec.facts} />
                        ) : null}
                        {spec.bullets && spec.bullets.length > 0 ? (
                          <BulletList items={spec.bullets} />
                        ) : null}
                        {spec.quote ? (
                          <Quote label={spec.quote.label} text={spec.quote.text} />
                        ) : null}
                        {action ? <Button label={action.label} url={action.url} /> : null}
                        {action ? <LinkFallback url={action.url} /> : null}
                        {(spec.after ?? []).map((text, index) => (
                          // biome-ignore lint/suspicious/noArrayIndexKey: static paragraphs.
                          <Paragraph key={index} text={text} muted small />
                        ))}
                        {spec.note ? <Note text={spec.note} /> : null}
                      </td>
                    </tr>
                  </Table>
                </ShadowBox>
              </td>
            </tr>

            {/* The footer: the PG tile, why this came, who sent it. */}
            <tr>
              <td style={{ padding: '28px 6px 0 0' }}>
                <Table>
                  <tr>
                    <td
                      width={44}
                      style={{ width: '44px', verticalAlign: 'top', paddingRight: '14px' }}
                    >
                      <img
                        src={`${webUrl}${ASSET_PATHS.tile}`}
                        width={32}
                        height={32}
                        alt="PG"
                        style={{
                          display: 'block',
                          border: 0,
                          outline: 'none',
                          width: '32px',
                          height: '32px',
                        }}
                      />
                    </td>
                    <td
                      className="pg-muted"
                      style={{
                        fontFamily: FONT_STACK,
                        fontSize: '12px',
                        lineHeight: '19px',
                        color: COLORS.muted,
                        verticalAlign: 'top',
                      }}
                    >
                      {spec.footer.reason}
                      <br />
                      {settingsUrl && spec.footer.settings ? (
                        <>
                          <a
                            href={settingsUrl}
                            className="pg-link"
                            style={{ color: COLORS.blue, textDecoration: 'underline' }}
                          >
                            {spec.footer.settings.label}
                          </a>
                          {', sent by '}
                        </>
                      ) : (
                        'Sent by '
                      )}
                      <a
                        href={webUrl}
                        className="pg-link"
                        style={{ color: COLORS.blue, textDecoration: 'underline' }}
                      >
                        PostGear
                      </a>
                      {` (${host}).`}
                    </td>
                  </tr>
                </Table>
              </td>
            </tr>
          </Table>
        </td>
      </tr>
    </Table>
  );
}

/**
 * The head: colour-scheme metas and the dark-mode rules (Apple Mail, iOS,
 * Outlook.com via `data-ogsc`), the small-screen rules, Sora for the clients
 * that load web fonts, and Arial for Outlook on Windows, which would
 * otherwise fall back to Times. Then the hidden preview line.
 */
function documentHtml({
  title,
  preview,
  body,
}: {
  title: string;
  preview: string;
  body: string;
}): string {
  const dark = `
.pg-page{background-color:${DARK.page}!important;}
.pg-card{background-color:${DARK.card}!important;}
.pg-inset{background-color:${DARK.inset}!important;}
.pg-border{border-color:${DARK.outline}!important;}
.pg-shadow{background-color:${DARK.outline}!important;}
.pg-text{color:${DARK.text}!important;}
.pg-muted{color:${DARK.muted}!important;}
.pg-link{color:${DARK.link}!important;}
.pg-row{border-color:#3a3a3a!important;}`;
  const ogsc = dark.replace(/\n\./g, '\n[data-ogsc] .');

  const css = `
:root{color-scheme:light dark;supported-color-schemes:light dark;}
body{margin:0;padding:0;width:100%!important;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;}
table,td{border-collapse:separate;}
img{-ms-interpolation-mode:bicubic;}
a{text-decoration:underline;}
@media (prefers-color-scheme: dark){${dark}
}
${ogsc}
@media only screen and (max-width:620px){
.pg-outer{padding:20px 10px 28px!important;}
.pg-px{padding-left:22px!important;padding-right:22px!important;}
.pg-h1{font-size:28px!important;line-height:34px!important;}
}`;

  // Spacer characters after the preview stop inboxes from pulling body text into it.
  const filler = '&#8199;&#65279;&#847; '.repeat(60);

  return [
    '<!DOCTYPE html>',
    '<html lang="en" dir="ltr" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta http-equiv="X-UA-Compatible" content="IE=edge">',
    '<meta name="x-apple-disable-message-reformatting">',
    '<meta name="format-detection" content="telephone=no, date=no, address=no, email=no, url=no">',
    '<meta name="color-scheme" content="light dark">',
    '<meta name="supported-color-schemes" content="light dark">',
    `<title>${escapeHtml(title)}</title>`,
    '<!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><style>table,td,div,h1,p,a,span{font-family:Arial,Helvetica,sans-serif!important;}</style><![endif]-->',
    '<!--[if !mso]><!--><link href="https://fonts.googleapis.com/css2?family=Sora:wght@400;600;700;800&amp;display=swap" rel="stylesheet"><!--<![endif]-->',
    `<style>${css}</style>`,
    '</head>',
    `<body class="pg-page" style="margin:0;padding:0;background-color:${COLORS.cream};">`,
    `<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">${escapeHtml(preview)}${filler}</div>`,
    body,
    '</body>',
    '</html>',
  ].join('\n');
}

/** The plain-text part, written from the same spec as the HTML. */
function plainText(
  webUrl: string,
  spec: EmailSpec,
  action: { label: string; url: string } | null,
  settingsUrl: string | null,
): string {
  const blocks: string[] = [spec.heading];

  blocks.push(...spec.intro);
  if (spec.facts && spec.facts.length > 0) {
    blocks.push(spec.facts.map((fact) => `${fact.label}: ${fact.value}`).join('\n'));
  }
  if (spec.bullets && spec.bullets.length > 0) {
    blocks.push(spec.bullets.map((item) => `- ${item}`).join('\n'));
  }
  if (spec.quote) {
    blocks.push(`${spec.quote.label}:\n${spec.quote.text}`);
  }
  if (action) {
    blocks.push(`${action.label}:\n${action.url}`);
  }
  blocks.push(...(spec.after ?? []));
  if (spec.note) {
    blocks.push(spec.note);
  }

  const footer = ['--', spec.footer.reason];
  if (settingsUrl && spec.footer.settings) {
    footer.push(`${spec.footer.settings.label}: ${settingsUrl}`);
  }
  footer.push(`Sent by PostGear (${webUrl})`);
  blocks.push(footer.join('\n'));

  return `${blocks.join('\n\n')}\n`;
}
