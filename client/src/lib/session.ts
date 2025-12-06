export const extractSessionId = (raw?: string | null) => {
  if (!raw) return '';
  const match = raw.trim().match(/^([A-Za-z0-9]+)/);
  return match ? match[1].toUpperCase() : '';
};

export const buildSessionSlug = (name?: string | null) => {
  if (!name) return '';
  const ascii = name
    .normalize('NFKD')
    .replace(/[^\x20-\x7E]/g, '')
    .toLowerCase();
  const slug = ascii.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').replace(/-{2,}/g, '-');
  return slug;
};

export const buildSessionPath = (id: string, name?: string | null) => {
  const trimmedId = id.trim();
  if (!trimmedId) return '';
  const slug = buildSessionSlug(name);
  return slug ? `${trimmedId}-${slug}` : trimmedId;
};
