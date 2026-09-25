import { readPythonVersion, pythonCommandParts } from "./pythonRuntime.js";
import { assertExactVersion, npmVersionFromUserAgent } from "./deliveryEnvCheckCore.js";

const EXPECTED_NODE = "24.14.1";
const EXPECTED_NPM = "11.12.1";
const EXPECTED_PYTHON = "3.13.11";

function runEnvCheck(): void {
  assertExactVersion("node", process.versions.node, EXPECTED_NODE);
  const npmUserAgent = process.env.npm_config_user_agent ?? "";
  assertExactVersion("npm", npmVersionFromUserAgent(npmUserAgent), EXPECTED_NPM);
  const pythonVersion = readPythonVersion(pythonCommandParts());
  assertExactVersion("python", pythonVersion, EXPECTED_PYTHON);
  console.log(`node ${process.versions.node} npm ${EXPECTED_NPM} python ${pythonVersion}`);
}

try {
  runEnvCheck();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
