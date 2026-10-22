/**
 * The analytics PDF (revamp, 2026-10-22): three A4 pages laid out with
 * `@react-pdf/renderer` from what `report-model.ts` worked out.
 *
 * The look is PostGear's own, in its calmer print form and in the Classic
 * dark theme (the owner's choice, 2026-10-23): the near-black page ground,
 * dark cards with the 1.5pt outline border and hard offset shadow, Sora
 * at the type roles' weights, colour only where it carries meaning (a
 * metric's sticker and line, a channel's colour, a move up or down). The
 * structure takes its cue from the owner's reference pack
 * (`docs/pdf-inspiration-or-editing/`): a running header and footer, a small
 * coloured eyebrow over a big two-tone title, chips under it, numbered
 * pages, and one blue "highlights" card. Its 3D illustrations are not
 * copied: they are image assets PostGear does not have.
 *
 * 1. The summary: the title, the four KPIs with their lines, the highlights.
 * 2. Performance: impressions and engagements per day by channel, and each
 *    channel's share.
 * 3. The top posts and the channels table.
 *
 * Only this file and `export-report.tsx` import the renderer, and both are
 * loaded on demand when someone exports, so the page itself never carries it.
 */
import {
  Circle,
  Document,
  Image,
  Line,
  Page,
  Path,
  StyleSheet,
  Svg,
  Text,
  View,
} from '@react-pdf/renderer';
import type { ComponentProps, ReactNode } from 'react';
import {
  chartGeometry,
  type ReportChannel,
  type ReportChart,
  type ReportData,
  type ReportIcon,
  type ReportKpi,
  sparkPaths,
} from './report-model';
import { ON_TONE, PDF_BORDER, PDF_COLORS, PDF_FONT, PDF_SHADOW, TONE_COLOR } from './report-theme';

/** Platform id to a PNG data URL of its logo; a missing one falls back to a dot. */
export type ReportLogos = Record<string, string>;

const C = PDF_COLORS;
const PAGE_WIDTH = 595.28;
const MARGIN = 40;
const CONTENT = PAGE_WIDTH - MARGIN * 2;
const CARD_PAD = 14;
const GAP = 14;

const styles = StyleSheet.create({
  page: {
    backgroundColor: C.ground,
    color: C.ink,
    fontFamily: PDF_FONT,
    fontSize: 9,
    paddingTop: 70,
    paddingBottom: 56,
    paddingHorizontal: MARGIN,
  },
  header: {
    position: 'absolute',
    top: 26,
    left: MARGIN,
    right: MARGIN,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  footer: {
    position: 'absolute',
    bottom: 24,
    left: MARGIN,
    right: MARGIN,
    flexDirection: 'row',
    justifyContent: 'space-between',
    color: C.muted,
    fontSize: 7.5,
  },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  brandLetter: { color: C.onPrimary, fontSize: 9, fontWeight: 800, lineHeight: 1 },
  brandName: { fontSize: 10, fontWeight: 700, letterSpacing: -0.3 },
  // Yellow, not blue: small blue text is too faint on the dark ground (violet
  // was tried on 2026-10-23 and the owner kept yellow).
  eyebrow: {
    color: C.secondary,
    fontSize: 9,
    fontWeight: 600,
    letterSpacing: 0.4,
    marginBottom: 6,
  },
  muted: { color: C.muted },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 14 },
  chip: { color: C.ink, fontSize: 8, fontWeight: 600 },
  cardTitle: { fontSize: 12, fontWeight: 700, letterSpacing: -0.3 },
  row: { flexDirection: 'row', alignItems: 'center' },
});

type PdfStyle = Exclude<NonNullable<ComponentProps<typeof View>['style']>, unknown[]>;

/**
 * Any bordered shape, drawn as two layers: the outline colour as the outer
 * shape, and the fill inset inside it by the border's width (2026-10-23).
 *
 * A PDF renderer paints a box's fill out to its outer edge, under the border,
 * and the anti-aliasing at rounded corners then let a thin ring of the fill
 * show outside the border (yellow round the % sticker, blue round the P
 * tile). With the fill inset, only outline-coloured pixels reach the edge.
 * `style` sizes and places the shape; `inner` lays out what is inside it.
 */
function Frame({
  fill,
  radius,
  border = PDF_BORDER,
  style,
  inner,
  children,
}: {
  fill: string;
  radius: number;
  border?: number;
  style?: PdfStyle;
  inner?: PdfStyle;
  children?: ReactNode;
}) {
  return (
    <View style={{ backgroundColor: C.outline, borderRadius: radius, padding: border, ...style }}>
      <View
        style={{
          backgroundColor: fill,
          borderRadius: Math.max(0, radius - border),
          flexGrow: 1,
          ...inner,
        }}
      >
        {children}
      </View>
    </View>
  );
}

/** The running header: the brand on the left, the report and page number on the right. */
function Header() {
  return (
    <View style={styles.header} fixed>
      <View style={styles.brand}>
        <Frame
          fill={C.primary}
          radius={4}
          style={{ width: 16, height: 16 }}
          inner={{ alignItems: 'center', justifyContent: 'center' }}
        >
          <Text style={styles.brandLetter}>P</Text>
        </Frame>
        <Text style={styles.brandName}>PostGear</Text>
      </View>
      <Text
        style={[styles.muted, { fontSize: 8 }]}
        render={({ pageNumber, totalPages }) =>
          `Analytics report    ${String(pageNumber).padStart(2, '0')} of ${String(totalPages).padStart(2, '0')}`
        }
      />
    </View>
  );
}

function Footer({ report }: { report: ReportData }) {
  return (
    <View style={styles.footer} fixed>
      <Text>
        {report.workspace}, {report.scope}
      </Text>
      <Text>Generated {report.generated}</Text>
    </View>
  );
}

/** A big two-tone title: the lead in ink, the accent in blue. */
function Title({ lead, accent, size = 40 }: { lead: string; accent: string; size?: number }) {
  return (
    <View>
      <Text
        style={{ fontSize: size, fontWeight: 800, letterSpacing: -size * 0.035, lineHeight: 1.02 }}
      >
        {lead}
      </Text>
      <Text
        style={{
          fontSize: size,
          fontWeight: 800,
          letterSpacing: -size * 0.035,
          lineHeight: 1.02,
          color: C.primary,
        }}
      >
        {accent}
      </Text>
    </View>
  );
}

/**
 * A card: the card fill, the outline border, and the hard shadow as a plate behind
 * it, offset down and right (a PDF has no box-shadow). `highlight` is the
 * blue highlights card.
 */
function Card({
  width,
  highlight = false,
  children,
  padding = CARD_PAD,
}: {
  width?: number;
  highlight?: boolean;
  children: ReactNode;
  padding?: number;
}) {
  return (
    <View
      wrap={false}
      style={{
        position: 'relative',
        width: width ?? CONTENT - PDF_SHADOW,
        marginRight: PDF_SHADOW,
        marginBottom: PDF_SHADOW,
      }}
    >
      <View
        style={{
          position: 'absolute',
          top: PDF_SHADOW,
          left: PDF_SHADOW,
          width: '100%',
          height: '100%',
          borderRadius: 10,
          backgroundColor: C.outline,
        }}
      />
      <Frame fill={highlight ? C.highlight : C.card} radius={10} inner={{ padding }}>
        {children}
      </Frame>
    </View>
  );
}

/** Lucide's outlines (ISC licence) for the four KPI stickers, on a 24-unit grid. */
function IconShape({ icon, color }: { icon: ReportIcon; color: string }) {
  const stroke = { stroke: color, strokeWidth: 2.5, fill: 'none' } as const;
  switch (icon) {
    case 'users':
      return (
        <>
          <Path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" {...stroke} />
          <Path d="M16 3.128a4 4 0 0 1 0 7.744" {...stroke} />
          <Path d="M22 21v-2a4 4 0 0 0-3-3.87" {...stroke} />
          <Circle cx="9" cy="7" r="4" {...stroke} />
        </>
      );
    case 'eye':
      return (
        <>
          <Path
            d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"
            {...stroke}
          />
          <Circle cx="12" cy="12" r="3" {...stroke} />
        </>
      );
    case 'heart':
      return (
        <Path
          d="M2 9.5a5.5 5.5 0 0 1 9.591-3.676.56.56 0 0 0 .818 0A5.49 5.49 0 0 1 22 9.5c0 2.29-1.5 4-3 5.5l-5.492 5.313a2 2 0 0 1-3 .019L5 15c-1.5-1.5-3-3.2-3-5.5"
          {...stroke}
        />
      );
    case 'percent':
      return (
        <>
          <Line x1="19" y1="5" x2="5" y2="19" {...stroke} />
          <Circle cx="6.5" cy="6.5" r="2.5" {...stroke} />
          <Circle cx="17.5" cy="17.5" r="2.5" {...stroke} />
        </>
      );
  }
}

function Sticker({ kpi }: { kpi: ReportKpi }) {
  return (
    <Frame
      fill={TONE_COLOR[kpi.tone]}
      radius={5}
      style={{ width: 22, height: 22 }}
      inner={{ alignItems: 'center', justifyContent: 'center' }}
    >
      <Svg width={12} height={12} viewBox="0 0 24 24">
        <IconShape icon={kpi.icon} color={ON_TONE[kpi.tone]} />
      </Svg>
    </Frame>
  );
}

/** A move up or down as a filled chip with its arrow, as on the page. */
function Delta({ direction, value }: { direction: 'up' | 'down'; value: string }) {
  const up = direction === 'up';
  return (
    <Frame
      fill={up ? C.success : C.danger}
      radius={999}
      border={1}
      inner={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 2,
        paddingVertical: 1.5,
        paddingLeft: 3,
        paddingRight: 5,
      }}
    >
      <Svg width={7} height={7} viewBox="0 0 24 24">
        <Path
          d={up ? 'M7 7h10v10 M7 17 17 7' : 'M7 7l10 10 M17 7v10H7'}
          stroke={C.onLight}
          strokeWidth={3.5}
          fill="none"
        />
      </Svg>
      <Text style={{ fontSize: 7.5, fontWeight: 700, color: C.onLight }}>{value}</Text>
    </Frame>
  );
}

function TrendText({
  kpi,
  against,
}: {
  kpi: Pick<ReportKpi, 'trend' | 'fallback'>;
  against: string;
}) {
  if (kpi.trend.kind === 'trend') {
    return (
      <View style={[styles.row, { gap: 5 }]}>
        <Delta direction={kpi.trend.direction} value={kpi.trend.value} />
        <Text style={[styles.muted, { fontSize: 7.5 }]}>{against}</Text>
      </View>
    );
  }
  return (
    <Text style={[styles.muted, { fontSize: 7.5 }]}>
      {kpi.trend.kind === 'even' ? `${kpi.trend.caption} ${against}` : kpi.fallback}
    </Text>
  );
}

const KPI_WIDTH = (CONTENT - GAP - PDF_SHADOW * 2) / 2;
const SPARK_WIDTH = KPI_WIDTH - CARD_PAD * 2 - PDF_BORDER * 2;

function KpiCard({ kpi, against }: { kpi: ReportKpi; against: string }) {
  const spark = sparkPaths(kpi.points, SPARK_WIDTH, 34, kpi.level);
  const color = TONE_COLOR[kpi.tone];

  return (
    <Card width={KPI_WIDTH}>
      <View style={[styles.row, { gap: 7 }]}>
        <Sticker kpi={kpi} />
        <Text style={styles.cardTitle}>{kpi.label}</Text>
      </View>
      <Text
        style={{
          fontSize: 26,
          fontWeight: 800,
          letterSpacing: -0.9,
          marginTop: 10,
          marginBottom: 6,
        }}
      >
        {kpi.value}
      </Text>
      <TrendText kpi={kpi} against={against} />
      <Svg width={SPARK_WIDTH} height={34} style={{ marginTop: 10 }}>
        {spark.area ? <Path d={spark.area} fill={color} fillOpacity={0.15} stroke="none" /> : null}
        {spark.line ? (
          <Path
            d={spark.line}
            stroke={color}
            strokeWidth={1.6}
            fill="none"
            strokeLinejoin="miter"
          />
        ) : (
          <Line
            x1={0}
            y1={17}
            x2={SPARK_WIDTH}
            y2={17}
            stroke={C.faint}
            strokeWidth={1.5}
            strokeDasharray="3 3"
          />
        )}
      </Svg>
    </Card>
  );
}

function Highlights({ report }: { report: ReportData }) {
  if (report.highlights.length === 0) return null;
  const width = (CONTENT - PDF_SHADOW - CARD_PAD * 2 - PDF_BORDER * 2 - 16 * 2) / 3;

  return (
    <Card highlight padding={18}>
      <Text style={{ color: C.secondary, fontSize: 9, fontWeight: 600, letterSpacing: 0.4 }}>
        Highlights
      </Text>
      <View style={{ flexDirection: 'row', gap: 16, marginTop: 10 }}>
        {report.highlights.map((highlight) => (
          <View key={highlight.label} style={{ width }}>
            <Text style={{ color: C.highlightMuted, fontSize: 7.5, marginBottom: 4 }}>
              {highlight.label}
            </Text>
            <Text
              style={{
                color: C.onPrimary,
                fontSize: 12,
                fontWeight: 700,
                letterSpacing: -0.3,
                lineHeight: 1.25,
              }}
            >
              {highlight.value}
            </Text>
            <Text style={{ color: C.highlightSoft, fontSize: 7.5, marginTop: 4, lineHeight: 1.35 }}>
              {highlight.detail}
            </Text>
          </View>
        ))}
      </View>
    </Card>
  );
}

function SummaryPage({ report }: { report: ReportData }) {
  const [lead, ...rest] = report.rangeLabel.split(' ');
  return (
    <Page size="A4" style={styles.page}>
      <Header />
      <Text style={styles.eyebrow}>Analytics report</Text>
      <Title lead={`Your ${lead.toLowerCase()}`} accent={rest.join(' ')} size={44} />
      <Text style={[styles.muted, { fontSize: 10, marginTop: 10, lineHeight: 1.4 }]}>
        {report.period}. {report.scope} in {report.workspace}.
      </Text>
      <View style={styles.chips}>
        {report.chips.map((chip) => (
          <Frame
            key={chip}
            fill={C.card}
            radius={999}
            border={1}
            inner={{ paddingVertical: 4, paddingHorizontal: 9 }}
          >
            <Text style={styles.chip}>{chip}</Text>
          </Frame>
        ))}
      </View>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: GAP, marginTop: 26 }}>
        {report.kpis.map((kpi) => (
          <KpiCard key={kpi.key} kpi={kpi} against={report.against} />
        ))}
      </View>

      <View style={{ marginTop: GAP + 4 }}>
        <Highlights report={report} />
      </View>

      {report.simulated ? (
        <Text style={[styles.muted, { fontSize: 7.5, marginTop: 14 }]}>
          These metrics are a local stand-in (ANALYTICS_SIMULATION), not read from the platforms.
        </Text>
      ) : null}

      <Footer report={report} />
    </Page>
  );
}

const CHART_WIDTH = CONTENT - PDF_SHADOW - CARD_PAD * 2 - PDF_BORDER * 2;
const CHART_HEIGHT = 118;

function Legend({ chart }: { chart: ReportChart }) {
  return (
    <View
      style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 10, marginBottom: 8 }}
    >
      {chart.series.map((line) => (
        <View key={line.id} style={[styles.row, { gap: 4 }]}>
          <Frame
            fill={TONE_COLOR[line.tone]}
            radius={0}
            border={1}
            style={{ width: 7, height: 7 }}
          />
          <Text style={{ fontSize: 7.5, fontWeight: 600 }}>{line.label}</Text>
        </View>
      ))}
    </View>
  );
}

function ChartCard({ chart, against }: { chart: ReportChart; against: string }) {
  const geometry = chartGeometry(chart, CHART_WIDTH, CHART_HEIGHT);

  return (
    <Card>
      <View
        style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' }}
      >
        <View>
          <Text style={styles.cardTitle}>{chart.title} Per Day</Text>
          <View style={[styles.row, { gap: 8, marginTop: 6 }]}>
            <Text style={{ fontSize: 20, fontWeight: 800, letterSpacing: -0.7 }}>
              {chart.total}
            </Text>
            <TrendText
              kpi={{ trend: chart.trend, fallback: 'No previous period' }}
              against={against}
            />
          </View>
        </View>
      </View>
      <Legend chart={chart} />
      <View style={{ position: 'relative', width: CHART_WIDTH, height: CHART_HEIGHT }}>
        <Svg width={CHART_WIDTH} height={CHART_HEIGHT}>
          {geometry.ticks.map((tick, index) => (
            <Line
              key={tick.y}
              x1={geometry.plot.left}
              x2={geometry.plot.right}
              y1={tick.y}
              y2={tick.y}
              stroke={index === 0 ? C.muted : C.faint}
              strokeWidth={index === 0 ? 1.2 : 0.7}
              strokeDasharray={index === 0 ? undefined : '2 3'}
            />
          ))}
          {geometry.lines.map((line) =>
            line.d ? (
              <Path
                key={line.id}
                d={line.d}
                stroke={TONE_COLOR[line.tone]}
                strokeWidth={1.8}
                fill="none"
                strokeLinejoin="miter"
              />
            ) : null,
          )}
        </Svg>
        {geometry.ticks.map((tick) => (
          <Text
            key={`label-${tick.y}`}
            style={{
              position: 'absolute',
              left: 0,
              width: geometry.plot.left - 6,
              top: tick.y - 4,
              fontSize: 6.5,
              textAlign: 'right',
              color: C.muted,
            }}
          >
            {tick.label}
          </Text>
        ))}
        {geometry.labels.map((label) => (
          <Text
            key={`x-${label.x}`}
            style={{
              position: 'absolute',
              top: CHART_HEIGHT - 12,
              left:
                label.anchor === 'start'
                  ? label.x
                  : label.anchor === 'end'
                    ? label.x - 40
                    : label.x - 20,
              width: 40,
              fontSize: 6.5,
              color: C.muted,
              textAlign:
                label.anchor === 'start' ? 'left' : label.anchor === 'end' ? 'right' : 'center',
            }}
          >
            {label.label}
          </Text>
        ))}
      </View>
    </Card>
  );
}

/** A platform's logo at `size`, or a dot in the channel's colour when it could not be drawn. */
function Logo({
  platform,
  logos,
  tone,
  size = 10,
}: {
  platform: string;
  logos: ReportLogos;
  tone: string;
  size?: number;
}) {
  const src = logos[platform];
  if (src) return <Image src={src} style={{ width: size, height: size, borderRadius: 2 }} />;
  return <Frame fill={tone} radius={size / 2} border={1} style={{ width: size, height: size }} />;
}

function SharesCard({ report, logos }: { report: ReportData; logos: ReportLogos }) {
  if (report.shares.length === 0) return null;

  return (
    <Card>
      <Text style={styles.cardTitle}>Share Of {report.sharesMetric}</Text>
      <Text style={[styles.muted, { fontSize: 8, marginTop: 3 }]}>
        Each channel's part of the total, biggest first.
      </Text>
      {/* One line per channel: name, bar, figure and share, so the card
          stays short enough to share the page with both charts. */}
      <View style={{ marginTop: 10, gap: 7 }}>
        {report.shares.map((share) => (
          <View key={share.id} style={[styles.row, { gap: 8 }]}>
            <View style={[styles.row, { gap: 5, width: 130 }]}>
              <Logo platform={share.platform} logos={logos} tone={TONE_COLOR[share.tone]} />
              <Text style={{ fontSize: 8.5, fontWeight: 700 }}>{share.name}</Text>
            </View>
            <Frame
              fill={C.ground}
              radius={999}
              border={1}
              style={{ flex: 1, height: 8 }}
              inner={{ overflow: 'hidden' }}
            >
              <View
                style={{
                  width: `${Math.max(2, Math.min(100, share.share))}%`,
                  height: '100%',
                  backgroundColor: TONE_COLOR[share.tone],
                }}
              />
            </Frame>
            <Text style={{ width: 52, fontSize: 8.5, textAlign: 'right' }}>{share.display}</Text>
            <Text style={[styles.muted, { width: 26, fontSize: 8.5, textAlign: 'right' }]}>
              {`${Math.round(share.share)}%`}
            </Text>
          </View>
        ))}
      </View>
    </Card>
  );
}

function PerformancePage({ report, logos }: { report: ReportData; logos: ReportLogos }) {
  return (
    <Page size="A4" style={styles.page}>
      <Header />
      <Text style={styles.eyebrow}>Performance</Text>
      <Title lead="How each channel" accent="performed" size={26} />
      <Text style={[styles.muted, { fontSize: 9.5, marginTop: 8, marginBottom: 18 }]}>
        One line per channel, per day, {report.period}.
      </Text>
      <View style={{ gap: GAP }}>
        {report.charts.map((chart) => (
          <ChartCard key={chart.metric} chart={chart} against={report.against} />
        ))}
        <SharesCard report={report} logos={logos} />
      </View>
      <Footer report={report} />
    </Page>
  );
}

const POST_COLUMNS = { views: 52, engagements: 64, rate: 40 };

function TopPostsCard({ report, logos }: { report: ReportData; logos: ReportLogos }) {
  if (report.topPosts.length === 0) {
    return (
      <Card>
        <Text style={styles.muted}>No published posts with metrics in this range.</Text>
      </Card>
    );
  }

  return (
    <Card padding={0}>
      <View
        style={[
          styles.row,
          {
            paddingHorizontal: CARD_PAD,
            paddingVertical: 8,
            borderBottomWidth: PDF_BORDER,
            borderColor: C.outline,
          },
        ]}
      >
        <Text style={{ flex: 1, fontSize: 7.5, fontWeight: 700 }}>Post</Text>
        <Text
          style={{ width: POST_COLUMNS.views, fontSize: 7.5, fontWeight: 700, textAlign: 'right' }}
        >
          Views
        </Text>
        <Text
          style={{
            width: POST_COLUMNS.engagements,
            fontSize: 7.5,
            fontWeight: 700,
            textAlign: 'right',
          }}
        >
          Engagements
        </Text>
        <Text
          style={{ width: POST_COLUMNS.rate, fontSize: 7.5, fontWeight: 700, textAlign: 'right' }}
        >
          Rate
        </Text>
      </View>
      {report.topPosts.map((post, index) => (
        <View
          key={post.rank}
          style={[
            styles.row,
            {
              gap: 8,
              paddingHorizontal: CARD_PAD,
              paddingVertical: 5,
              borderBottomWidth: index === report.topPosts.length - 1 ? 0 : 0.75,
              borderColor: C.faint,
            },
          ]}
        >
          <Frame
            fill={post.rank === 1 ? C.secondary : C.card}
            radius={4}
            style={{ width: 18, height: 18 }}
            inner={{ alignItems: 'center', justifyContent: 'center' }}
          >
            <Text
              style={{
                fontSize: 8,
                fontWeight: 800,
                lineHeight: 1,
                color: post.rank === 1 ? C.onLight : C.ink,
              }}
            >
              {post.rank}
            </Text>
          </Frame>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 8.5, fontWeight: 600 }}>{post.text}</Text>
            <View style={[styles.row, { gap: 4, marginTop: 2 }]}>
              <Logo platform={post.platform} logos={logos} tone={TONE_COLOR[post.tone]} size={8} />
              <Text style={[styles.muted, { fontSize: 7 }]}>
                {post.channel}, published {post.published}
              </Text>
            </View>
          </View>
          <Text style={{ width: POST_COLUMNS.views, fontSize: 8.5, textAlign: 'right' }}>
            {post.views}
          </Text>
          <Text style={{ width: POST_COLUMNS.engagements, fontSize: 8.5, textAlign: 'right' }}>
            {post.engagements}
          </Text>
          <Text
            style={{ width: POST_COLUMNS.rate, fontSize: 8.5, fontWeight: 700, textAlign: 'right' }}
          >
            {post.rate}
          </Text>
        </View>
      ))}
    </Card>
  );
}

const CHANNEL_COLUMNS = {
  status: 92,
  followers: 62,
  impressions: 64,
  engagements: 66,
  rate: 40,
  posts: 34,
};

function StatusPill({ channel }: { channel: ReportChannel }) {
  const fill =
    channel.statusTone === 'success'
      ? C.success
      : channel.statusTone === 'danger'
        ? C.danger
        : C.ground;
  return (
    <Frame
      fill={fill}
      radius={999}
      border={1}
      style={{ alignSelf: 'flex-start' }}
      inner={{ paddingVertical: 1.5, paddingHorizontal: 6 }}
    >
      <Text
        style={{
          fontSize: 7,
          fontWeight: 700,
          color: channel.statusTone === 'neutral' ? C.ink : C.onLight,
        }}
      >
        {channel.status}
      </Text>
    </Frame>
  );
}

function ChannelsCard({ report, logos }: { report: ReportData; logos: ReportLogos }) {
  const head = (label: string, width: number, align: 'left' | 'right' = 'right') => (
    <Text style={{ width, fontSize: 7.5, fontWeight: 700, textAlign: align }}>{label}</Text>
  );

  return (
    <Card padding={0}>
      <View
        style={[
          styles.row,
          {
            paddingHorizontal: CARD_PAD,
            paddingVertical: 8,
            borderBottomWidth: PDF_BORDER,
            borderColor: C.outline,
          },
        ]}
      >
        <Text style={{ flex: 1, fontSize: 7.5, fontWeight: 700 }}>Channel</Text>
        {head('Status', CHANNEL_COLUMNS.status, 'left')}
        {head('Followers', CHANNEL_COLUMNS.followers)}
        {head('Impressions', CHANNEL_COLUMNS.impressions)}
        {head('Engagements', CHANNEL_COLUMNS.engagements)}
        {head('Rate', CHANNEL_COLUMNS.rate)}
        {head('Posts', CHANNEL_COLUMNS.posts)}
      </View>
      {report.channels.map((channel, index) => (
        <View
          key={channel.id}
          style={[
            styles.row,
            {
              paddingHorizontal: CARD_PAD,
              paddingVertical: 8,
              borderBottomWidth: index === report.channels.length - 1 ? 0 : 0.75,
              borderColor: C.faint,
            },
          ]}
        >
          <View style={[styles.row, { flex: 1, gap: 5 }]}>
            <Text style={{ fontSize: 8.5, fontWeight: 700 }}>{channel.name}</Text>
            <Logo platform={channel.platform} logos={logos} tone={TONE_COLOR[channel.tone]} />
          </View>
          <View style={{ width: CHANNEL_COLUMNS.status }}>
            <StatusPill channel={channel} />
          </View>
          <View style={{ width: CHANNEL_COLUMNS.followers, alignItems: 'flex-end' }}>
            <Text style={{ fontSize: 8.5 }}>{channel.followers}</Text>
            {channel.followersDelta ? (
              <Text
                style={{
                  fontSize: 6.5,
                  fontWeight: 700,
                  color: channel.followersDelta.startsWith('+') ? C.success : C.danger,
                }}
              >
                {channel.followersDelta}
              </Text>
            ) : null}
          </View>
          <Text style={{ width: CHANNEL_COLUMNS.impressions, fontSize: 8.5, textAlign: 'right' }}>
            {channel.impressions}
          </Text>
          <Text style={{ width: CHANNEL_COLUMNS.engagements, fontSize: 8.5, textAlign: 'right' }}>
            {channel.engagements}
          </Text>
          <Text
            style={{
              width: CHANNEL_COLUMNS.rate,
              fontSize: 8.5,
              fontWeight: 700,
              textAlign: 'right',
            }}
          >
            {channel.rate}
          </Text>
          <Text style={{ width: CHANNEL_COLUMNS.posts, fontSize: 8.5, textAlign: 'right' }}>
            {channel.posts}
          </Text>
        </View>
      ))}
    </Card>
  );
}

function DetailPage({ report, logos }: { report: ReportData; logos: ReportLogos }) {
  return (
    <Page size="A4" style={styles.page}>
      <Header />
      <Text style={styles.eyebrow}>Top posts</Text>
      <Title lead="What worked" accent="best" size={26} />
      <Text style={[styles.muted, { fontSize: 9.5, marginTop: 8, marginBottom: 16 }]}>
        Ranked by engagement in the range.
      </Text>
      <TopPostsCard report={report} logos={logos} />

      <View style={{ marginTop: 22 }} wrap={false}>
        <Text style={styles.eyebrow}>Channels</Text>
        <Text style={[styles.muted, { fontSize: 9.5, marginBottom: 10 }]}>
          Every account in the range, with how its metrics are syncing.
        </Text>
        <ChannelsCard report={report} logos={logos} />
      </View>
      <Footer report={report} />
    </Page>
  );
}

export function ReportDocument({ report, logos }: { report: ReportData; logos: ReportLogos }) {
  return (
    <Document
      title={`PostGear analytics, ${report.rangeLabel.toLowerCase()}`}
      author="PostGear"
      subject={`${report.workspace}, ${report.period}`}
      creator="PostGear"
      producer="PostGear"
    >
      <SummaryPage report={report} />
      {report.charts.length > 0 || report.shares.length > 0 ? (
        <PerformancePage report={report} logos={logos} />
      ) : null}
      <DetailPage report={report} logos={logos} />
    </Document>
  );
}
