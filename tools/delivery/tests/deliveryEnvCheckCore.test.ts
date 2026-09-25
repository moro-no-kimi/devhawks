import { describe, expect, it } from "vitest";
import { assertExactVersion, npmVersionFromUserAgent } from "../src/deliveryEnvCheckCore.js";

describe("delivery environment pin checks", () => {
  it("extracts exact npm version token from npm user-agent", () => {
    const userAgent = "npm/11.12.1 node/v24.14.1 win32 x64";
    expect(npmVersionFromUserAgent(userAgent)).toBe("11.12.1");
  });

  it("does not accept missing npm token", () => {
    expect(npmVersionFromUserAgent("node/v24.14.1 linux x64")).toBeNull();
  });

  it("fails exact version assertions for mismatched values", () => {
    expect(() => assertExactVersion("npm", "11.12.0", "11.12.1")).toThrow(/npm mismatch/);
    expect(() => assertExactVersion("npm", null, "11.12.1")).toThrow(/npm mismatch/);
  });
});
