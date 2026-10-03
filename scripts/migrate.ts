import { createDb } from "../src/lib/db/client";

const handle = await createDb();
await handle.migrate();
console.log(`Migrations applied (${handle.kind}).`);
await handle.close();
