/* =====================================================================
   DIL FANTASY — development seed
   OPTIONAL and never run automatically. It inserts sample rows so the
   participant list and leaderboard are not empty while you develop.

       node server/seed.js          insert sample rows
       node server/seed.js --clear  remove them again

   Every row it writes is a real database row read through the normal
   queries — the front end has no idea it is sample data, because there
   is no client-side demo path left. Sample accounts use the email
   domain @sample.dilfantasy.et, which is how --clear finds them.
   ===================================================================== */

'use strict';

const { db, init, hashPassword, encrypt, currentGameweek, syncFplData, seededRandom } = require('./db');

const FIRST = ['Abel', 'Mekdes', 'Yonas', 'Samuel', 'Bekele', 'Hanna', 'Dawit', 'Selam',
  'Kalkidan', 'Nahom', 'Betelhem', 'Eyob', 'Tsion', 'Henok', 'Ruth', 'Yared', 'Meron',
  'Fitsum', 'Liya', 'Getachew', 'Sara', 'Amanuel', 'Rahel', 'Tewodros', 'Genet', 'Robel'];
const LAST = ['Tesfaye', 'Alemu', 'Bekele', 'Habte', 'Girma', 'Mekonnen', 'Assefa', 'Tadesse',
  'Wolde', 'Desta', 'Abebe', 'Kebede', 'Haile', 'Gebre', 'Mulugeta', 'Negash', 'Lemma'];
const TEAMS = ['Red Devils', 'Blue Lions', 'Abyssinia FC', 'Goal Getters', 'Sheger United',
  'Entoto XI', 'Rift Valley FC', 'Lucy Legends', 'Addis Arsenal', 'Nile Navigators',
  'Simien Squad', 'Habesha Hotspur', 'Awash Athletic', 'Bale Mountain FC', 'Danakil Dynamo',
  'Gonder Gunners', 'Tana Titans', 'Lalibela Lions', 'Jimma Jets', 'Omo Olympians'];

const SAMPLE_DOMAIN = '@sample.dilfantasy.et';

function clear() {
  const users = db.prepare('SELECT id FROM users WHERE email LIKE ?').all(`%${SAMPLE_DOMAIN}`);
  // Foreign keys cascade, so deleting the users removes their rows everywhere.
  db.prepare('DELETE FROM users WHERE email LIKE ?').run(`%${SAMPLE_DOMAIN}`);
  console.log(`[seed] removed ${users.length} sample accounts and all their rows`);
}

function seed(count = 32) {
  const existing = db.prepare('SELECT COUNT(*) AS n FROM users WHERE email LIKE ?')
    .get(`%${SAMPLE_DOMAIN}`);
  if (existing.n > 0) {
    console.log(`[seed] ${existing.n} sample accounts already present — nothing to do`);
    return;
  }

  const gw = currentGameweek();
  const rnd = seededRandom(20260816);
  const password = hashPassword('SampleAccount2026');
  const insertUser = db.prepare(`
    INSERT INTO users (full_name, age, phone, email, password_hash,
                       fpl_manager_id, fpl_team_name, reward_method,
                       reward_account_encrypted, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'telebirr', ?, ?)`);
  const insertReg = db.prepare(`
    INSERT INTO registrations (user_id, gameweek_id, payment_method, status, submitted_at, verified_at)
    VALUES (?, ?, 'telebirr', ?, ?, ?)`);

  let created = 0;
  for (let i = 0; i < count; i++) {
    const name = `${FIRST[Math.floor(rnd() * FIRST.length)]} ${LAST[Math.floor(rnd() * LAST.length)]}`;
    const managerId = String(1000001 + Math.floor(rnd() * 8000000));
    try {
      const info = insertUser.run(
        name, 20 + Math.floor(rnd() * 25), `+2519${10000000 + i}`,
        `sample${i + 1}${SAMPLE_DOMAIN}`, password, managerId,
        TEAMS[Math.floor(rnd() * TEAMS.length)],
        encrypt(`09${10000000 + i}`), Date.now());
      const userId = Number(info.lastInsertRowid);
      const applied = gw.registration_open_at + Math.floor(rnd() * 36 * 3600 * 1000);
      const confirmed = rnd() > 0.22;
      insertReg.run(userId, gw.id, confirmed ? 'confirmed' : 'under_review',
        applied, confirmed ? applied + 3600000 : null);
      created++;
    } catch (err) {
      // Duplicate manager id or email: skip and keep going.
    }
  }
  syncFplData();
  console.log(`[seed] created ${created} sample accounts registered for Gameweek ${gw.gw_number}`);
}

init();
if (process.argv.includes('--clear')) clear();
else seed(Number(process.argv[2]) || 32);
