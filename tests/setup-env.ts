import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// Every test file gets its own data/storage root so tests never touch the real studio.
const base = process.env.PINPO_TEST_TMP ?? tmpdir();
process.env.PINPO_HOME = mkdtempSync(path.join(base, "pinpo-test-"));
process.env.PINPO_SOURCE_ROOT = process.cwd();
