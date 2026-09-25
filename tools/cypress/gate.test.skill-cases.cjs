"use strict";

const verifier = require("./verify-skills.cjs");
const { spawnSync } = require("node:child_process");

function copyRepoSkills(skillsRoot, fs, path) {
  const source = path.join(verifier.REPO_ROOT, ".github", "skills");
  fs.copyFileSync(
    path.join(source, "cypress-ai-skills-provenance.json"),
    path.join(skillsRoot, "cypress-ai-skills-provenance.json")
  );
  fs.copyFileSync(path.join(source, "CYPRESS-LICENSE"), path.join(skillsRoot, "CYPRESS-LICENSE"));
  for (const skill of verifier.REQUIRED_SKILLS) {
    fs.cpSync(path.join(source, skill), path.join(skillsRoot, skill), { recursive: true });
  }
}

function registerChecksumCases(ctx) {
  const { test, assert, path } = ctx;
  test("record-checksums dry-run succeeds with current pinned provenance", () => {
    const result = spawnSync("node", ["tools/cypress/record-checksums.cjs"], {
      cwd: verifier.REPO_ROOT,
      encoding: "utf-8"
    });
    assert.strictEqual(result.status, 0, result.stderr || result.stdout);
    assert.ok(/PROVENANCE (ALREADY CURRENT|UPDATED|DRY RUN)/.test(result.stdout));
  });

  test("verify-skills passes against repository skills tree", () => {
    const root = path.join(verifier.REPO_ROOT, ".github", "skills");
    assert.strictEqual(
      verifier.verify(root, path.join(root, "cypress-ai-skills-provenance.json")),
      true
    );
  });
}

function registerIntegrityCases(ctx) {
  const { test, fs, path, makeFixtureDir, assert } = ctx;
  test("verify-skills detects tampered skill content", () => {
    const dir = makeFixtureDir("verify-skill-tamper");
    const skillsRoot = path.join(dir, "skills");
    fs.mkdirSync(skillsRoot, { recursive: true });
    copyRepoSkills(skillsRoot, fs, path);
    fs.appendFileSync(
      path.join(skillsRoot, "cypress-tap", "references", "recipes.md"),
      "\nTAMPERED-CONTENT\n"
    );
    const ok = verifier.verify(
      skillsRoot,
      path.join(skillsRoot, "cypress-ai-skills-provenance.json")
    );
    assert.strictEqual(ok, false);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test("verify-skills detects a record with fabricated checksums", () => {
    const dir = makeFixtureDir("verify-skill-fake");
    const skillsRoot = path.join(dir, "skills");
    fs.mkdirSync(skillsRoot, { recursive: true });
    copyRepoSkills(skillsRoot, fs, path);
    const provPath = path.join(skillsRoot, "cypress-ai-skills-provenance.json");
    const prov = JSON.parse(fs.readFileSync(provPath, "utf8"));
    prov.fileChecksums = { "cypress-author/SKILL.md": "sha256:" + "0".repeat(64) };
    fs.writeFileSync(provPath, JSON.stringify(prov));
    const ok = verifier.verify(skillsRoot, provPath);
    assert.strictEqual(ok, false);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test("verify-skills runs clean-HOME safe (user-level skills not required)", () => {
    const saved = process.env.USERPROFILE;
    const emptyHome = makeFixtureDir("empty-home");
    fs.mkdirSync(path.join(emptyHome, ".copilot", "skills"), { recursive: true });
    process.env.USERPROFILE = emptyHome;
    try {
      assert.strictEqual(verifier.verify(null, null), true);
    } finally {
      process.env.USERPROFILE = saved;
      fs.rmSync(emptyHome, { recursive: true, force: true });
    }
  });
}

function registerAllowlistCases(ctx) {
  const { test, fs, path, makeFixtureDir, assert } = ctx;
  for (const mode of [
    "extra-directory",
    "extra-declaration",
    "duplicate-declaration",
    "missing-declaration"
  ]) {
    test("verify-skills rejects " + mode, () => {
      const dir = makeFixtureDir("skill-allowlist");
      const root = path.join(dir, "skills");
      try {
        fs.mkdirSync(root, { recursive: true });
        copyRepoSkills(root, fs, path);
        const provPath = path.join(root, "cypress-ai-skills-provenance.json");
        const prov = JSON.parse(fs.readFileSync(provPath, "utf8"));
        if (mode === "extra-directory") {
          const extra = path.join(root, "cypress-cloud-cli");
          fs.mkdirSync(extra);
          fs.writeFileSync(path.join(extra, "SKILL.md"), "---\nname: cypress-cloud-cli\n---\n");
        }
        if (mode === "extra-declaration") {
          prov.installedSkills.push({ name: "cypress-cloud-cli", included: true });
        }
        if (mode === "duplicate-declaration") prov.installedSkills.push(prov.installedSkills[0]);
        if (mode === "missing-declaration") prov.installedSkills.pop();
        fs.writeFileSync(provPath, JSON.stringify(prov));
        assert.strictEqual(verifier.verify(root, provPath), false);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });
  }
}

module.exports = function registerSkillCaseSet(ctx) {
  registerChecksumCases(ctx);
  registerIntegrityCases(ctx);
  registerAllowlistCases(ctx);
};
