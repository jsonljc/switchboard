import type { Playbook, ScanResult } from "@switchboard/schemas";

type IdFactory = (index: number) => string;
const defaultIdFactory: IdFactory = () => crypto.randomUUID();

export function hydratePlaybookFromScan(
  base: Playbook,
  scan: ScanResult,
  idFactory: IdFactory = defaultIdFactory,
): Playbook {
  const playbook = structuredClone(base);

  if (scan.businessName || scan.category || scan.location) {
    playbook.businessIdentity = {
      ...playbook.businessIdentity,
      name: scan.businessName?.value ?? playbook.businessIdentity.name,
      category: scan.category?.value ?? playbook.businessIdentity.category,
      location: scan.location?.value ?? playbook.businessIdentity.location,
      status: "check_this",
      source: "scan",
    };
  }

  if (scan.services.length > 0) {
    playbook.services = scan.services.map((s, i) => ({
      id: idFactory(i),
      name: s.name,
      price: s.price,
      duration: s.duration,
      bookingBehavior: "ask_first" as const,
      status: "check_this" as const,
      source: "scan" as const,
    }));
  }

  if (scan.hours && Object.keys(scan.hours).length > 0) {
    playbook.hours = {
      ...playbook.hours,
      schedule: scan.hours,
      status: "check_this",
      source: "scan",
    };
  }

  if (scan.contactMethods.length > 0) {
    playbook.channels = {
      ...playbook.channels,
      configured: scan.contactMethods,
      status: "check_this",
      source: "scan",
    };
  }

  return playbook;
}
