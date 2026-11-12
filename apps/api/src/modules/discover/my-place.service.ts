/**
 * The place each member chose (Sprint 11 Module 10, backlog #6), so Discover
 * opens where they left it on any browser. Only a person's own choices are
 * kept: a guess and the workspace's place are not choices, so the page never
 * sends them, and going back to the workspace's place clears the row.
 */
import { Injectable } from '@nestjs/common';
import { DiscoverLocationSource } from '@postgear/db';
import type { MyPlaceInput } from './dto/my-place.schema';
import { DiscoverMyPlaceRepository, type MyPlaceRow } from './my-place.repository';

export interface MyPlaceView {
  countryCode: string | null;
  regionCode: string | null;
  regionName: string | null;
  city: string | null;
  timeZone: string | null;
  language: string | null;
  topic: string | null;
  locationSource: DiscoverLocationSource;
  updatedAt: string;
}

function toView(row: MyPlaceRow): MyPlaceView {
  return { ...row, updatedAt: row.updatedAt.toISOString() };
}

@Injectable()
export class DiscoverMyPlaceService {
  constructor(private readonly repository: DiscoverMyPlaceRepository) {}

  async get(userId: string, orgId: string): Promise<MyPlaceView | null> {
    const row = await this.repository.find(userId, orgId);
    // A row cleared by hand to NONE says nothing was chosen.
    return row && row.locationSource !== DiscoverLocationSource.NONE ? toView(row) : null;
  }

  async save(userId: string, orgId: string, input: MyPlaceInput): Promise<MyPlaceView | null> {
    if (input.locationSource === DiscoverLocationSource.NONE) {
      await this.repository.clear(userId, orgId);
      return null;
    }
    return toView(await this.repository.save(userId, orgId, input));
  }

  clear(userId: string, orgId: string): Promise<void> {
    return this.repository.clear(userId, orgId);
  }
}
