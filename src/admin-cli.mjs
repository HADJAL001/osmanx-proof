import { openDatabase } from './db.mjs';
import { createServices } from './services.mjs';
const email=process.env.ADMIN_EMAIL;
if(!email){console.error('Set ADMIN_EMAIL to an existing registered user.');process.exit(1)}
const db=openDatabase();const userId=createServices(db).setAdmin(email);db.close();
console.log(`Administrator rights assigned to user ID ${userId}.`);
