import dotenv from "dotenv";

import {
  EXPORT_PATH,
  runSkillGemWithPostgres,
  writeSkillGemExportPostgres
} from "./skill-gems/runtime.mjs";

dotenv.config();

const data = await runSkillGemWithPostgres((pool) => writeSkillGemExportPostgres(pool));
console.log(JSON.stringify({ database: "postgres", exportPath: EXPORT_PATH, total: data.total }, null, 2));
