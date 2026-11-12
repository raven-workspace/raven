/** OffSec student IDs look like OS-12345. */
export function isValidOsid(osid: string): boolean {
  return /^OS-\d+$/.test(osid);
}
