// Slug a user-provided project name into something safe for a folder name.
// We do NOT use this as the unique ID — projects have a separate nanoid.
// But the folder on disk is named with the slug so users can recognise it.

export function slugify(input: string): string {
  const lower = input.normalize("NFKD").toLowerCase();
  const stripped = lower.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return stripped.length > 0 ? stripped.slice(0, 64) : "project";
}

const ALLOWED_NAME = /^[a-zA-Z0-9 _\-.]{1,80}$/;
export function isValidProjectName(name: string): boolean {
  return ALLOWED_NAME.test(name.trim());
}
