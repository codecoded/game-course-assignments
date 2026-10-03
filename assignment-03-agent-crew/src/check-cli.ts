// Run the simulation engineer's checker on a saved package: bun run check out/<id>/mission-package.json
import { check } from "./checker";

const path = process.argv[2];
if (!path) throw new Error("usage: bun run check <mission-package.json>");
const r = check(await Bun.file(path).json());
console.log(JSON.stringify(r, null, 2));
process.exit(r.pass ? 0 : 1);
