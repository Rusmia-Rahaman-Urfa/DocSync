import { closeDb, getDb } from './db.js';

const db = getDb();
const users = db.prepare('SELECT COUNT(*) AS count FROM users').get().count;
const documents = db.prepare('SELECT COUNT(*) AS count FROM documents').get().count;
const shares = db.prepare('SELECT COUNT(*) AS count FROM shares').get().count;

console.log(`Seed complete: ${users} users, ${documents} documents, ${shares} shares.`);
closeDb();
