
import { appendFileSync } from "node:fs";

const args = process.argv.slice(2);
appendFileSync(process.env.GH_LOG, `${JSON.stringify(args)}\n`);
if (args.includes("--jq")) {
  if (process.env.GH_LIST_EXIT) process.exit(Number(process.env.GH_LIST_EXIT));
  process.stdout.write(process.env.GH_LOOKUP ?? "");
} else if (process.env.GH_POST_EXIT) {
  process.exit(Number(process.env.GH_POST_EXIT));
}
