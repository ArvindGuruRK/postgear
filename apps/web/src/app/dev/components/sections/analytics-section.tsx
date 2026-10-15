'use client';

import {
  Avatar,
  AvatarFallback,
  BarList,
  ScoreBar,
  ScoreGauge,
  Sparkline,
  StatCard,
  TrendChart,
} from '@postgear/ui';
import { Eye, Heart } from 'lucide-react';
import { Row, Section, Spec } from '../shared';

/**
 * Sprint 7's data-visualisation primitives, kept in their own section because
 * they are the restrained profile taken to its limit (design-system-rules.md
 * §15, §16c): flat strokes and fills from the action tokens, hard grid lines,
 * body face on every axis label, the display face only on the one number a
 * reading is about. Every sample is deterministic so a screenshot diff is a
 * regression, not noise.
 */

const DAYS = Array.from({ length: 30 }, (_, index) => {
  const date = new Date(Date.UTC(2026, 8, 15 + index));
  return date.toISOString().slice(0, 10);
});

/** A smooth, deterministic shape: weekly rhythm over a gentle climb. */
function shaped(base: number, amplitude: number, phase: number): number[] {
  return DAYS.map((_, index) =>
    Math.round(base + index * (amplitude / 20) + amplitude * Math.sin((index + phase) / 2.3) * 0.5),
  );
}

const IMPRESSIONS = shaped(1200, 400, 0);
const ENGAGEMENTS = shaped(80, 40, 3);

export function AnalyticsSection() {
  return (
    <Section
      title="Analytics & Scores"
      description="Gauges, bars and charts for the analytics dashboard and the SEO analyzer — flat strokes from the action tokens, no gradients, body face on the data."
    >
      <Row label="Score Gauge (tone follows the grade band)">
        <ScoreGauge value={92} grade="A" label="Overall" size="sm" />
        <ScoreGauge value={74} grade="C" label="Overall" />
        <ScoreGauge value={61} grade="D" label="Overall" size="sm" />
        <ScoreGauge value={38} grade="F" label="Overall" size="sm" />
        <ScoreGauge value={null} label="Pending" size="sm" />
        <Spec>
          role=meter · 240° arc, butt caps · stroke-actionSuccess ≥80 / actionSecondary ≥70 /
          actionAccent ≥60 / actionDanger · number font-display
        </Spec>
      </Row>

      <Row label="Score Bar">
        <div className="grid w-full gap-4 sm:grid-cols-2">
          <ScoreBar label="On-page" score={88} hint="30% of total" />
          <ScoreBar label="Technical" score={72} hint="30% of total" />
          <ScoreBar label="Content" score={64} hint="25% of total" />
          <ScoreBar label="Authority" score={41} hint="15% · estimated" />
        </div>
        <Spec>Progress striped=false animated=false · tone via toneForScore()</Spec>
      </Row>

      <Row label="Stat Card with trend">
        <StatCard
          label="Impressions"
          value="34,120"
          icon={Eye}
          trend={{ value: '+12.4% vs previous 30 days', direction: 'up' }}
        />
        <StatCard
          label="Engagements"
          value="2,418"
          icon={Heart}
          trend={{ value: '-3.1% vs previous 30 days', direction: 'down' }}
        />
      </Row>

      <Row label="Trend Chart (one series = area on; hover or arrow keys read a day)">
        <div className="w-full">
          <TrendChart
            aria-label="Impressions over 30 days"
            series={[
              {
                id: 'impressions',
                label: 'Impressions',
                points: DAYS.map((x, index) => ({ x, y: IMPRESSIONS[index] })),
              },
            ]}
          />
        </div>
        <Spec>
          stroke 3px miter · fill-actionPrimary/15 area · grid stroke-outline/20 dashed · axes
          font-sans text-[10px] · tooltip = role=status live region
        </Spec>
      </Row>

      <Row label="Trend Chart (two series, gap in one)">
        <div className="w-full">
          <TrendChart
            aria-label="Impressions and engagements"
            height={180}
            series={[
              {
                id: 'impressions',
                label: 'Impressions',
                tone: 'primary',
                points: DAYS.map((x, index) => ({ x, y: IMPRESSIONS[index] })),
              },
              {
                id: 'engagements',
                label: 'Engagements',
                tone: 'ai',
                points: DAYS.map((x, index) => ({
                  x,
                  y: index > 10 && index < 14 ? null : ENGAGEMENTS[index] * 10,
                })),
              },
            ]}
          />
        </div>
      </Row>

      <Row label="Sparkline">
        <Sparkline points={IMPRESSIONS} />
        <Sparkline points={ENGAGEMENTS} tone="ai" />
        <Sparkline points={[]} />
        <Spec>96×28 · 2px stroke · aria-hidden (numbers sit beside it)</Spec>
      </Row>

      <Row label="Bar List (engagement rate by channel)">
        <div className="w-full max-w-md">
          <BarList
            items={[
              {
                id: 'li',
                label: 'Acme Marketing',
                value: 6.8,
                display: '6.8%',
                hint: 'LinkedIn · 12 posts',
                leading: (
                  <Avatar size="sm">
                    <AvatarFallback>AM</AvatarFallback>
                  </Avatar>
                ),
              },
              {
                id: 'ig',
                label: 'Acme Studio',
                value: 4.1,
                display: '4.1%',
                hint: 'Instagram · 9 posts',
                tone: 'ai',
                leading: (
                  <Avatar size="sm">
                    <AvatarFallback>AS</AvatarFallback>
                  </Avatar>
                ),
              },
              {
                id: 'x',
                label: 'Acme on X',
                value: 1.9,
                display: '1.9%',
                hint: 'X · needs reconnect',
                tone: 'danger',
                leading: (
                  <Avatar size="sm">
                    <AvatarFallback>AX</AvatarFallback>
                  </Avatar>
                ),
              },
            ]}
          />
        </div>
        <Spec>track h-3 rounded-full border-2 · fill bg-action* · hard edge border-r-2</Spec>
      </Row>
    </Section>
  );
}
