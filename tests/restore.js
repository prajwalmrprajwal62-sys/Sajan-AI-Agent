import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, '..', 'data');
const backupDir = path.join(__dirname, '..', 'data', 'backup_temp');

const filesToBackup = ['sajan.db', 'memories.json', 'preferences.json'];

export function restore() {
  if (!fs.existsSync(backupDir)) {
    console.log('No backup directory found, nothing to restore.');
    return;
  }

  for (const file of filesToBackup) {
    const src = path.join(backupDir, file);
    const dest = path.join(dataDir, file);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, dest);
      console.log(`Restored ${file} from backup.`);
      fs.unlinkSync(src);
    }
  }

  try {
    fs.rmdirSync(backupDir);
    console.log('Cleaned up backup directory.');
  } catch (err) {
    // Check if it still has contents (e.g. other files), don't fail hard
    console.log('Finished restoring files.');
  }
}

// Support running this script directly
if (process.argv[1] && (process.argv[1].endsWith('restore.js') || process.argv[1] === fileURLToPath(import.meta.url))) {
  restore();
}
