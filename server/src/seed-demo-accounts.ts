import { storageRoot as resolveStorageRoot } from "./storage-root.js";
import { openAtomDatabase } from "./db.js";
import { seedDemoAccounts } from "./demo-accounts.js";

const storageRoot = resolveStorageRoot();
const database = openAtomDatabase(storageRoot);

try {
  const accounts = seedDemoAccounts(database.db);
  console.log("ATOM demo accounts are ready. Existing sessions for these accounts were revoked.\n");
  for (const account of accounts) {
    console.log(`${account.role.toUpperCase()} | ${account.displayName}`);
    console.log(`Username: ${account.loginIdentifier}`);
    console.log(`Password: ${account.password}\n`);
  }
} finally {
  database.db.close();
}
