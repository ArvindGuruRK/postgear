/**
 * The workspace's speech privacy switch (Sprint 13, Module 17 item 26).
 *
 * Decision D13-03 lets the media service send long speech to a hosted
 * listener (`TRANSCRIBER=auto`, Groq) and named a per-workspace switch as the
 * thing to add when a privacy-first customer asks. This is that switch:
 * `Organization.clipsSpeechStaysHere`. On, every listen in the workspace runs
 * on our own machine; the worker reads it right before the sound would leave
 * (so a job that waited in the queue obeys a change made meanwhile) and the
 * media service refuses the hosted lane for that job.
 *
 * Reading it is open to every member (Clip Setup's privacy hint says which way
 * it is set); changing it is an admin's (`PUT`, `@Roles(ADMIN)`). A change is
 * logged with ids only.
 */
import { Injectable, Logger } from '@nestjs/common';
import { prisma } from '@postgear/db';
import type { HostedLaneState } from '../status/media-service.probe';
import { MediaServiceProbe } from '../status/media-service.probe';

export interface ClipPrivacy {
  /** Every listen in this workspace stays on our own machine. */
  speechStaysHere: boolean;
  /** Where long speech goes on this PostGear when the switch is off. */
  hostedLane: HostedLaneState;
}

@Injectable()
export class ClipPrivacyService {
  private readonly logger = new Logger(ClipPrivacyService.name);

  constructor(private readonly mediaService: MediaServiceProbe) {}

  /** The switch alone, for `GET /clips/status`. A missing workspace reads as off. */
  async speechStaysHere(orgId: string): Promise<boolean> {
    const row = await prisma.organization.findUnique({
      where: { id: orgId },
      select: { clipsSpeechStaysHere: true },
    });
    return row?.clipsSpeechStaysHere ?? false;
  }

  async view(orgId: string): Promise<ClipPrivacy> {
    const [speechStaysHere, hostedLane] = await Promise.all([
      this.speechStaysHere(orgId),
      this.mediaService.hostedLane(),
    ]);
    return { speechStaysHere, hostedLane };
  }

  async set(orgId: string, speechStaysHere: boolean, by: string): Promise<ClipPrivacy> {
    await prisma.organization.update({
      where: { id: orgId },
      data: { clipsSpeechStaysHere: speechStaysHere },
      select: { id: true },
    });
    this.logger.log(
      JSON.stringify({ event: 'clips.privacy.speech_stays_here', orgId, by, on: speechStaysHere }),
    );
    return this.view(orgId);
  }
}
