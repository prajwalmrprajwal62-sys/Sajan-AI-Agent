import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, '..', 'data');
const backupDir = path.join(__dirname, '..', 'data', 'backup_temp');

const filesToBackup = ['sajan.db', 'memories.json', 'preferences.json'];

export function backup() {
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  for (const file of filesToBackup) {
    const src = path.join(dataDir, file);
    const dest = path.join(backupDir, file);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, dest);
      console.log(`Backed up ${file} to ${dest}`);
    } else {
      console.log(`File ${file} does not exist, skipping backup.`);
    }
  }
}

// Support running this script directly
if (process.argv[1] && (process.argv[1].endsWith('backup.js') || process.argv[1] === fileURLToPath(import.meta.url))) {
  backup();
}
