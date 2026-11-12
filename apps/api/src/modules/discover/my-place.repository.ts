/**
 * The place each member chose (Sprint 11 Module 10, backlog #6): the only
 * thing that touches `DiscoverUserPlace`. One row per person per workspace,
 * keyed by both, so nobody can read or write another person's choice. Like
 * the workspace's place, it is a city, a region, a country and a zone, never
 * a position.
 */
import { Injectable } from '@nestjs/common';
import { type DiscoverLocationSource, prisma } from '@postgear/db';

export interface MyPlaceRow {
  countryCode: string | null;
  regionCode: string | null;
  regionName: string | null;
  city: string | null;
  timeZone: string | null;
  language: string | null;
  topic: string | null;
  locationSource: DiscoverLocationSource;
  updatedAt: Date;
}

export type MyPlaceWrite = Omit<MyPlaceRow, 'updatedAt'>;

const MY_PLACE_SELECT = {
  countryCode: true,
  regionCode: true,
  regionName: true,
  city: true,
  timeZone: true,
  language: true,
  topic: true,
  locationSource: true,
  updatedAt: true,
} as const;

@Injectable()
export class DiscoverMyPlaceRepository {
  find(userId: string, orgId: string): Promise<MyPlaceRow | null> {
    return prisma.discoverUserPlace.findUnique({
      where: { userId_organizationId: { userId, organizationId: orgId } },
      select: MY_PLACE_SELECT,
    });
  }

  save(userId: string, orgId: string, write: MyPlaceWrite): Promise<MyPlaceRow> {
    const columns = {
      countryCode: write.countryCode,
      regionCode: write.regionCode,
      regionName: write.regionName,
      city: write.city,
      timeZone: write.timeZone,
      language: write.language,
      topic: write.topic,
      locationSource: write.locationSource,
    };
    return prisma.discoverUserPlace.upsert({
      where: { userId_organizationId: { userId, organizationId: orgId } },
      create: { userId, organizationId: orgId, ...columns },
      update: columns,
      select: MY_PLACE_SELECT,
    });
  }

  async clear(userId: string, orgId: string): Promise<void> {
    await prisma.discoverUserPlace.deleteMany({ where: { userId, organizationId: orgId } });
  }
}
