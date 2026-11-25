/**
 * A verified street's id (030): readable and stable - the place and the name,
 * slugged - so the same street always has the same id in the database, the
 * form and the tests. Accents and punctuation do not matter: "Biñang 2nd" and
 * "Binang 2nd" give the same id.
 */
export const slug = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
export const streetIdFor = (province: string, municipality: string, barangay: string, name: string) =>
  [province, municipality, barangay, name].map(slug).join(':');
