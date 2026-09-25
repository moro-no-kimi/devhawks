#!/usr/bin/env node
/**
 * T02 (lane Q) — Cypress skill discovery / provenance verification for CI.
 *
 * Verifies ONLY repository-installed skills under .github\skills\ (clean-HOME
 * safe: the user-level skills directory is never required) and verifies
 * content integrity by pinning actual file checksums against the provenance
 * record — not just that a 40-hex revision string exists.
 *
 * Fail-closed exits 1 if: any required skill, its SKILL.md, its expected
 * version, its recorded checksums, or the provenance record itself is
 * missing, mismatched, or otherwise inconsistent.
 *
 * This is a filesystem-level verification only. It does NOT demonstrate live
 * agent skill activation (deferred to T12 per work_plan.md).
 */
"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const SKILLS_ROOT = path.join(REPO_ROOT, ".github", "skills");
const PROVENANCE = path.join(SKILLS_ROOT, "cypress-ai-skills-provenance.json");

const REQUIRED_SKILLS = ["cypress-author", "cypress-explain", "cypress-docs", "cypress-tap"];
const EXPECTED_VERSIONS = {
  "cypress-author": "1.0.1",
  "cypress-explain": "1.0.1",
  "cypress-docs": "1.0.0",
  "cypress-tap": "1.0.0"
};

function fail(msg) {
  // Library form: never touches process.exitCode; verify() returns false and
  // the CLI wrapper sets the exit code. Newline-safe, JSON-encoded details.
  console.error("FAIL: " + JSON.stringify(String(msg)));
}

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function listFiles(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(full));
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

function parseFrontmatter(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  return match ? match[1] : null;
}

function readProvenance(provFile) {
  try {
    return JSON.parse(fs.readFileSync(provFile, "utf8"));
  } catch (error) {
    fail("cannot read provenance record " + provFile + ": " + (error.code || error.message));
    return null;
  }
}

function validateProvenanceRecord(prov) {
  const pinnedCommit = prov.revision && prov.revision.commit;
  if (!pinnedCommit || !/^[0-9a-f]{40}$/.test(pinnedCommit)) {
    fail("provenance record missing a full pinned upstream commit sha");
    return null;
  }
  if (!Array.isArray(prov.installedSkills) || prov.installedSkills.length === 0) {
    fail("provenance record declares no installed skills");
    return null;
  }
  return {
    pinnedCommit,
    fileChecksums: prov.fileChecksums || {}
  };
}

function validateLicense(root, fileChecksums, problems) {
  const license = path.join(root, "CYPRESS-LICENSE");
  if (!fs.existsSync(license)) {
    problems.push("missing Cypress upstream license notice");
    return;
  }
  if (fileChecksums["CYPRESS-LICENSE"] !== "sha256:" + sha256(license)) {
    problems.push("checksum mismatch for CYPRESS-LICENSE");
  }
}

function readSkillFrontmatter(skillMd, problems) {
  let text;
  try {
    text = fs.readFileSync(skillMd, "utf8");
  } catch (error) {
    problems.push("missing " + skillMd + " (" + error.code + ")");
    return null;
  }
  const frontmatter = parseFrontmatter(text);
  if (!frontmatter) {
    problems.push(skillMd + " has no YAML frontmatter");
  }
  return frontmatter;
}

function validateSkillMetadata(skill, frontmatter, skillMd, problems) {
  const nameMatch = /(?:^|\n)name:\s*([^\s]+)/.exec(frontmatter);
  const versionMatch = /(?:^|\n)\s{2}version:\s*([^\s]+)/.exec(frontmatter);
  if (!nameMatch || nameMatch[1].trim() !== skill) {
    problems.push(skillMd + " frontmatter name missing or mismatched");
  }
  if (!versionMatch || versionMatch[1].trim() !== EXPECTED_VERSIONS[skill]) {
    problems.push(
      skillMd +
        " frontmatter version missing or mismatched (expected " +
        EXPECTED_VERSIONS[skill] +
        ")"
    );
  }
}

function validateSkillChecksums(context) {
  const { skill, skillDir, root, fileChecksums, problems } = context;
  for (const file of listFiles(skillDir).sort()) {
    const rel = skill + "/" + path.relative(skillDir, file).replace(/\\/g, "/");
    const expected = fileChecksums[rel];
    if (!expected || typeof expected !== "string") {
      problems.push("provenance has no checksum for " + rel);
      continue;
    }
    const actual = "sha256:" + sha256(file);
    if (expected !== actual) {
      problems.push("checksum mismatch for " + rel);
    }
  }

  for (const rel of Object.keys(fileChecksums)) {
    if (!rel.startsWith(skill + "/")) continue;
    const target = path.join(root, rel);
    if (!fs.existsSync(target)) {
      problems.push("provenance records checksum for missing file: " + rel);
    }
  }
}

function validateSkill(context) {
  const { root, skill, prov, fileChecksums, problems } = context;
  const declaredSkill = prov.installedSkills.find((entry) => entry.name === skill);
  if (!declaredSkill) {
    problems.push("provenance record does not declare " + skill);
    return;
  }
  if (skill === "cypress-tap" && declaredSkill.activation !== "deferred-to-T12") {
    problems.push("cypress-tap provenance does not mark activation as deferred-to-T12");
  }

  const skillDir = path.join(root, skill);
  const skillMd = path.join(skillDir, "SKILL.md");
  const frontmatter = readSkillFrontmatter(skillMd, problems);
  if (!frontmatter) return;
  validateSkillMetadata(skill, frontmatter, skillMd, problems);
  validateSkillChecksums({ skill, skillDir, root, fileChecksums, problems });
}

function hasCloudCliExclusion(prov) {
  return (prov.explicitlyNotInstalled || []).some((entry) => entry.name === "cypress-cloud-cli");
}

function finishVerification(problems, root, pinnedCommit) {
  if (problems.length > 0) {
    problems.forEach(fail);
    return false;
  }
  console.log(
    "PASS: " +
      REQUIRED_SKILLS.length +
      " skills verified in " +
      root +
      " (filesystem level, checksums pinned, upstream " +
      pinnedCommit +
      ")"
  );
  return true;
}

// Verifiable core. Reads skills from `skillsRoot` and the provenance record
// from `provenancePath`, so tests can exercise a fixture tree without touching
// the real repository files. Throws nothing; void problems silently on
// individual failure lines. Returns true on pass; accumulates problems on
// process.exitCode = 1.
function verify(skillsRoot, provenancePath) {
  const root = skillsRoot || SKILLS_ROOT;
  const provFile = provenancePath || PROVENANCE;
  const prov = readProvenance(provFile);
  if (!prov) return false;
  const validated = validateProvenanceRecord(prov);
  if (!validated) return false;
  const { pinnedCommit, fileChecksums } = validated;

  const problems = [];
  validateLicense(root, fileChecksums, problems);
  for (const skill of REQUIRED_SKILLS) {
    validateSkill({ root, skill, prov, fileChecksums, problems });
  }
  if (!hasCloudCliExclusion(prov)) {
    problems.push(
      "provenance record does not declare cypress-cloud-cli as explicitly not installed"
    );
  }
  return finishVerification(problems, root, pinnedCommit);
}

module.exports.verify = verify;
module.exports.EXPECTED_VERSIONS = EXPECTED_VERSIONS;
module.exports.REQUIRED_SKILLS = REQUIRED_SKILLS;
module.exports.REPO_ROOT = REPO_ROOT;
module.exports.SKILLS_ROOT = SKILLS_ROOT;
module.exports.PROVENANCE = PROVENANCE;

if (require.main === module) {
  const ok = verify();
  if (!ok) process.exitCode = 1;
}
