/**
 * URL-safe slug from a title.
 *
 * NFKD then stripping combining marks turns "Café" into "cafe" rather than
 * dropping the accented character outright. Scripts with no ASCII equivalent
 * (Cyrillic, for instance) strip to nothing, so there is a fallback — an
 * empty string would hit a NOT NULL unique column.
 */
export function slugify(title: string): string {
  const slug = title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return slug.length > 0 ? slug : 'untitled';
}

/**
 * First free slug in the `base`, `base-2`, `base-3` sequence.
 *
 * Two pressings of the same album is a realistic case, so a collision must
 * suffix rather than fail the write on a unique-constraint violation.
 */
export async function uniqueSlug(
  base: string,
  exists: (slug: string) => Promise<boolean>,
): Promise<string> {
  if (!(await exists(base))) {
    return base;
  }

  let suffix = 2;
  while (await exists(`${base}-${suffix}`)) {
    suffix += 1;
  }
  return `${base}-${suffix}`;
}
