import { lookupCountry, parseIpCountryCsv } from './ip-country';

/** Out of order on purpose, with a header, a quoted row, CRLF, and lines that are not ranges. */
const CSV = [
  'ip_start,ip_end,country',
  '8.8.8.0,8.8.8.255,US',
  '1.0.0.0,1.0.0.255,AU',
  '"49.204.0.0","49.207.255.255","IN"',
  '0.0.0.0,0.255.255.255,ZZ',
  '2001:200::,2001:200:ffff:ffff:ffff:ffff:ffff:ffff,JP',
  '2a01:e00::,2a01:e3f:ffff:ffff:ffff:ffff:ffff:ffff,FR',
  '10.0.0.0,10.255.255.255,US',
  '5.5.5.0,5.5.5.255,ZZ',
  '9.9.9.9,9.9.9.1,US',
  '1.2.3,1.2.3.4,US',
  '2001:db8::,2001:db8::ff,DE',
  '1.1.1.0,2001::,AU',
  'garbage',
  '',
].join('\r\n');

const table = parseIpCountryCsv(CSV);

describe('parseIpCountryCsv', () => {
  it('keeps the ranges with a country, sorted, and counts what it skipped', () => {
    expect([...table.v4Starts]).toEqual([16777216, 134744064, 167772160, 835452928]);
    expect(table.v6Countries).toHaveLength(3);
    // The header, both ZZ rows, the backwards range, the short address, the mixed pair, and "garbage".
    expect(table.skipped).toBe(7);
  });
});

describe('lookupCountry', () => {
  it('finds IPv4 and IPv6 addresses, and an IPv4 address inside IPv6', () => {
    expect(lookupCountry(table, '8.8.8.8')).toBe('US');
    expect(lookupCountry(table, '1.0.0.255')).toBe('AU');
    expect(lookupCountry(table, '49.205.1.2')).toBe('IN');
    expect(lookupCountry(table, '2001:200:1234::1')).toBe('JP');
    expect(lookupCountry(table, '[2a01:e34:ec5a::1]')).toBe('FR');
    expect(lookupCountry(table, '::ffff:8.8.8.4')).toBe('US');
    expect(lookupCountry(table, '::ffff:808:801')).toBe('US');
    expect(lookupCountry(table, '0:0:0:0:0:ffff:49.204.0.1')).toBe('IN');
  });

  it('answers null for private, reserved and uncovered addresses, ZZ, and anything malformed', () => {
    for (const ip of [
      '10.1.2.3', // private, even though the file wrongly covers it
      '127.0.0.1',
      '192.168.1.10',
      '100.64.0.1',
      '169.254.10.10',
      '224.0.0.1',
      '255.255.255.255',
      '::1',
      '::',
      'fe80::1%eth0',
      'fd12:3456::1',
      '2001:db8::1',
      '::ffff:192.168.0.1',
      '64:ff9b::808:808',
      '5.5.5.5', // a ZZ range
      '0.1.2.3',
      '8.8.9.1', // between ranges
      '2001:300::1',
      '08.8.8.8',
      '8.8.8',
      '256.1.1.1',
      '1::2::3',
      '1:2:3:4:5:6:7:8:9',
      '::ffff:1.2.3.4.5',
      '1.2.3.4::',
      'not an address',
      '',
    ]) {
      expect([ip, lookupCountry(table, ip)]).toEqual([ip, null]);
    }
  });
});
