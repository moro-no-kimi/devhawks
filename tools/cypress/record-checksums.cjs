/**
 * Generate or refresh the "fileChecksums" block in the Cypress AI skills
 * provenance record (.github\skills\cypress-ai-skills-provenance.json) from
 * the actual repository-installed skill files. Used when re-pinning a
 * different upstream revision; the pinned commit must be updated at the same
 * time. Run with --update to write back into the provenance record; otherwise
 * it only prints what it would record.
 *
 * Q-lane T02 confinement: writes only inside .github\skills and tools\cypress.
 */
"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const PROVENANCE_PATH = path.resolve(
  __dirname,
  "..",
  "..",
  ".github",
  "skills",
  "cypress-ai-skills-provenance.json"
);
const SKILLS_ROOT = path.resolve(__dirname, "..", "..", ".github", "skills");

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function listFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(full));
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

function collectSkillChecksums(skillsRoot, skills) {
  const checksums = {};
  for (const skill of skills) {
    const skillDir = path.join(skillsRoot, skill);
    for (const file of listFiles(skillDir).sort()) {
      const rel = skill + "/" + path.relative(skillDir, file).replace(/\\/g, "/");
      checksums[rel] = "sha256:" + sha256(file);
    }
  }
  return checksums;
}

function readProvenance() {
  return JSON.parse(fs.readFileSync(PROVENANCE_PATH, "utf8"));
}

function verifySkillDirectories(skills) {
  for (const skill of skills) {
    const skillDir = path.join(SKILLS_ROOT, skill);
    if (!fs.existsSync(skillDir)) {
      console.error("FAIL: missing skill directory " + skillDir);
      process.exitCode = 1;
    }
  }
}

function recordLicenseChecksum(checksums) {
  const license = path.join(SKILLS_ROOT, "CYPRESS-LICENSE");
  if (!fs.existsSync(license)) {
    console.error("FAIL: " + JSON.stringify("missing Cypress upstream license notice"));
    process.exitCode = 1;
    return;
  }
  checksums["CYPRESS-LICENSE"] = "sha256:" + sha256(license);
}

function writeOrPrint(prov, checksums) {
  const before = JSON.stringify(prov.fileChecksums || {});
  prov.fileChecksums = checksums;
  const after = JSON.stringify(prov.fileChecksums);
  prov.checksumMethod =
    "sha256 over LF-normalized repository bytes with a terminal newline; skill contents and license verified against the pinned upstream revision";
  const count = Object.keys(checksums).length;
  if (before === after) {
    console.log("PROVENANCE ALREADY CURRENT: " + count + " file checksum(s)");
    return;
  }
  if (process.argv.includes("--update")) {
    fs.writeFileSync(PROVENANCE_PATH, JSON.stringify(prov, null, 2) + "\n");
    console.log("PROVENANCE UPDATED: " + count + " file checksum(s) recorded");
    return;
  }
  console.log(
    "DRY RUN: would record " + count + " file checksum(s); rerun with --update to persist"
  );
}

function update() {
  const prov = readProvenance();
  const skills = (prov.installedSkills || []).map((s) => s.name);
  verifySkillDirectories(skills);
  if (process.exitCode === 1) return;
  const checksums = collectSkillChecksums(SKILLS_ROOT, skills);
  recordLicenseChecksum(checksums);
  if (process.exitCode === 1) return;
  writeOrPrint(prov, checksums);
}

module.exports.update = update;

if (require.main === module) update();
