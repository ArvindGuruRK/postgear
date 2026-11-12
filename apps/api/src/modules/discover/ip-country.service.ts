/**
 * The IP first guess (Sprint 11 Module 10, backlog #13): a country for a
 * first visit, from a country table the operator downloads (DB-IP Lite,
 * CC BY 4.0) and names in `DISCOVER_IP_COUNTRY_FILE`.
 *
 * It is a fallback under the time-zone guess, never above a choice: the page
 * only asks when the browser's zone says nothing useful (UTC, or a zone shared
 * by several countries). Only a country comes out of it. The address is read
 * from the request, looked up in memory and forgotten: it is never logged,
 * stored or sent anywhere.
 *
 * Without the file, or with a file that cannot be read, every guess is null
 * and the boot log says why once. The table is read once, on the first guess,
 * so a deployment that never asks never pays for it.
 */
import { readFile } from 'node:fs/promises';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  type IpCountryTable,
  isKnownCountry,
  lookupCountry,
  parseIpCountryCsv,
} from '@postgear/discover-engine';
import type { Env } from '../../config/env';

@Injectable()
export class IpCountryService {
  private readonly logger = new Logger(IpCountryService.name);
  private table: Promise<IpCountryTable | null> | null = null;

  constructor(private readonly config: ConfigService<Env, true>) {}

  get configured(): boolean {
    return Boolean(this.config.get('DISCOVER_IP_COUNTRY_FILE', { infer: true }));
  }

  /** An ISO 3166-1 country for the address, or null. Never throws. */
  async countryOf(ip: string | undefined): Promise<string | null> {
    if (!ip || !this.configured) return null;
    const table = await this.load();
    if (!table) return null;
    try {
      // Express reports an IPv4 client on a dual-stack socket as `::ffff:1.2.3.4`.
      const address = ip.startsWith('::ffff:') ? ip.slice(7) : ip;
      const country = lookupCountry(table, address);
      return country && isKnownCountry(country) ? country : null;
    } catch {
      return null;
    }
  }

  private load(): Promise<IpCountryTable | null> {
    this.table ??= this.read();
    return this.table;
  }

  private async read(): Promise<IpCountryTable | null> {
    const file = this.config.get('DISCOVER_IP_COUNTRY_FILE', { infer: true });
    if (!file) return null;
    try {
      const table = parseIpCountryCsv(await readFile(file, 'utf8'));
      this.logger.log(JSON.stringify({ event: 'discover.ip_country.loaded' }));
      return table;
    } catch (error) {
      this.logger.warn(
        JSON.stringify({
          event: 'discover.ip_country.unreadable',
          reason: error instanceof Error ? error.name : 'unknown',
        }),
      );
      return null;
    }
  }
}
