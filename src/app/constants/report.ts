export const REPORT_REASONS = [
  { key: 'spam_fake' },
  { key: 'harassment' },
  { key: 'sexual_harassment' },
  { key: 'hate_speech' },
  { key: 'nudity_inappropriate' },
  { key: 'underage' },
  { key: 'physical_danger' },
] as const;

export type ReportReasonKey = (typeof REPORT_REASONS)[number]['key'];
