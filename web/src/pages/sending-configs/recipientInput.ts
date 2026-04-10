const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function parseRecipientInput(value: string): string[] {
  return value
    .split(/[\n,，;；]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function hasOnlyValidRecipients(value: string): boolean {
  const recipients = parseRecipientInput(value);
  return recipients.length > 0 && recipients.every((item) => emailPattern.test(item));
}
