// Which Sieve is this? version.json is written by the Pages workflow at deploy time (version from
// sieve/__init__.py, commit, build time in UTC); a local checkout has "local".
let cached;
export function getVersion() {
  cached ||= fetch("version.json", { cache: "no-store" }).then(r => (r.ok ? r.json() : null)).catch(() => null)
    .then(v => v || { version: "?", commit: "local", built: "local" });
  return cached;
}
export const versionText = v => `Sieve ${v.version}${v.commit && v.commit !== "local" ? ` · ${v.commit}` : " · local"}${v.built && v.built !== "local" ? ` · built ${v.built.replace("T", " ").replace("Z", " UTC")}` : ""}`;
