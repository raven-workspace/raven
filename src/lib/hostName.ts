const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

/** The first DNS label of a host name; IPs and single labels come back unchanged. */
export function shortHostName(name: string): string {
  if (IPV4.test(name) || name.includes(":")) return name;
  const label = name.split(".")[0];
  return label ? label : name;
}
