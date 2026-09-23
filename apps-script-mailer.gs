/**
 * ตัวส่งอีเมลของ "ระบบดูแลครุภัณฑ์และเครื่องมือวิทยาศาสตร์ — PSU:LASC"
 * ------------------------------------------------------------------
 * ระบบเป็นเว็บแบบไม่มีเซิร์ฟเวอร์ จึงส่งอีเมลเองไม่ได้ สคริปต์นี้ทำหน้าที่ส่งอีเมลจากบัญชี Google ของหน่วยงาน
 *
 *   type = 'test'         ปุ่ม "ทดสอบอีเมล" ในหน้าตั้งค่า (ต้องเป็นเจ้าหน้าที่ที่ล็อกอินอยู่) → ส่งถึงผู้กด
 *   type = 'digest'       ปุ่ม "ส่งสรุปแจ้งเตือนตอนนี้" (ต้องเป็นเจ้าหน้าที่ที่ล็อกอินอยู่) → ส่งรายการ PM/สอบเทียบที่ใกล้ครบกำหนดหรือเกินกำหนด
 *   type = 'inboundFault' เรียกจากระบบจองใช้เครื่องมือวิทยาศาสตร์ (psu-lasc-equipment) เมื่อมีผู้แจ้งเครื่องมือชำรุด
 *                         ยืนยันตัวตนด้วย INBOUND_SECRET (คนละกลไกกับ idToken เพราะเป็นคนละโปรเจกต์ Firebase)
 *
 * วิธีติดตั้ง (ทำครั้งเดียว ~5 นาที)
 *   1. https://script.google.com → New project → วางโค้ดนี้ทับทั้งหมด
 *   2. แก้ DB_URL และ FIREBASE_PROJECT ด้านล่างให้ตรงกับโปรเจกต์ Firebase ของระบบนี้
 *   3. เลือกฟังก์ชัน authorize → Run → อนุญาตสิทธิ์ (ส่งอีเมล + เชื่อมต่อภายนอก)
 *   4. Deploy → New deployment → Web app · Execute as: Me · Who has access: Anyone
 *   5. คัดลอก Web app URL (ลงท้าย /exec) → หน้าแอดมิน แท็บ "ตั้งค่าระบบ" → ช่อง Mailer URL → บันทึก
 *
 * แก้โค้ดภายหลัง: Deploy → Manage deployments → ✏️ → Version: New version → Deploy (URL เดิมใช้ต่อได้)
 * โควตา: Gmail ทั่วไป ~100 ฉบับ/วัน · Google Workspace ~1,500 ฉบับ/วัน
 *
 * ----- ตั้งเวลาส่งสรุปแจ้งเตือนอัตโนมัติทุกวัน (ไม่บังคับ) -----
 * ฟังก์ชัน sendDailyDigestAuto() อ่านข้อมูลด้วย "Database secret" (ของเก่าที่ Firebase ยังรองรับ)
 * เพื่อให้ทำงานได้เองโดยไม่ต้องมีใครเปิดหน้าเว็บ:
 *   1. Firebase Console → ⚙ Project settings → Service accounts → Database secrets → Show/Add secret
 *   2. คัดลอกค่ามาใส่ DB_SECRET ด้านล่าง
 *   3. ในหน้า Apps Script: นาฬิกาซ้ายมือ (Triggers) → Add Trigger →
 *      Function: sendDailyDigestAuto · Event source: Time-driven · Day timer → เลือกช่วงเวลาที่ต้องการ → Save
 */

/* ===== ค่าที่ต้องแก้ ===== */
const DB_URL = 'https://psu-lasc-maintenance-default-rtdb.asia-southeast1.firebasedatabase.app';
const FIREBASE_PROJECT = 'psu-lasc-maintenance';
const DB_SECRET = ''; /* จำเป็นสำหรับ "รับแจ้งชำรุดจากระบบจองใช้เครื่องมือ" และ "ส่งสรุปอัตโนมัติทุกวัน" — ดูวิธีขอค่านี้ในคอมเมนต์ท้ายไฟล์ */
const SENDER_NAME = 'ศูนย์บริการสัตว์ทดลอง ม.อ.';
const ADMIN_URL = ''; /* ที่อยู่หน้าเว็บของระบบนี้ เช่น https://xxx.github.io/lasc-maintenance/ */

/* รหัสลับสำหรับรับข้อมูลแจ้งชำรุดจากระบบจองใช้เครื่องมือวิทยาศาสตร์ (psu-lasc-equipment)
   ต้องตั้งให้ตรงกับช่อง "รหัสลับ (secret)" ในหน้าตั้งค่าของระบบจองฯ ตรงหัวข้อ
   "แจ้งเตือนไปยังระบบดูแลครุภัณฑ์และเครื่องมือวิทยาศาสตร์" — ตั้งเป็นข้อความสุ่มที่คาดเดายาก */
const INBOUND_SECRET = '';
/* ===== จบส่วนที่ต้องแก้ ===== */

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) return json({ ok: false, error: 'no payload' });
    const d = JSON.parse(e.postData.contents);

    /* รับแจ้งชำรุดจากระบบจองใช้เครื่องมือ — ยืนยันตัวตนด้วยรหัสลับที่ตั้งไว้ร่วมกัน ไม่ใช้ idToken เพราะเป็นคนละโปรเจกต์ Firebase */
    if (d.type === 'inboundFault') return json(receiveInboundFault(d));

    const who = verifyStaff(d.idToken);
    if (!who) return json({ ok: false, error: 'unauthorized — ต้องเข้าสู่ระบบด้วยบัญชีเจ้าหน้าที่' });
    if (d.type === 'test') return json(sendTest(who));
    if (d.type === 'digest') return json(sendDigest(d, who));
    return json({ ok: false, error: 'unknown type' });
  } catch (err) {
    return json({ ok: false, error: String(err) });
  }
}

/* ---------- รับแจ้งชำรุดจากระบบจองใช้เครื่องมือวิทยาศาสตร์ (psu-lasc-equipment) ----------
   จับคู่ด้วยรหัสครุภัณฑ์ (eqCode) กับทะเบียนครุภัณฑ์ของระบบนี้ · บันทึกไว้ที่ data/asset/incomingFaults
   แล้วอีเมลแจ้งผู้รับผิดชอบเครื่องมือ (equipment.responsibleEmail) ถ้ามีการตั้งค่าไว้ */
function receiveInboundFault(d) {
  if (!INBOUND_SECRET) return { ok: false, error: 'ยังไม่ได้ตั้งค่า INBOUND_SECRET ในสคริปต์นี้' };
  if (str(d.secret) !== INBOUND_SECRET) return { ok: false, error: 'unauthorized' };
  if (!DB_SECRET) return { ok: false, error: 'ยังไม่ได้ตั้งค่า DB_SECRET ในสคริปต์นี้' };
  const eqCode = str(d.eqCode), symptom = str(d.symptom);
  if (!eqCode || !symptom) return { ok: false, error: 'missing eqCode/symptom' };

  const equipment = dbGet('data/asset/equipment') || {};
  let matchId = null, matchEq = null;
  Object.keys(equipment).forEach(function (id) {
    const eq = equipment[id];
    if (eq && String(eq.code || '').trim().toLowerCase() === eqCode.trim().toLowerCase()) { matchId = id; matchEq = eq; }
  });

  const id = 'IF-' + Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyyMMdd-HHmmss') + '-' + Math.random().toString(36).slice(2, 6).toUpperCase();
  const rec = {
    id: id, source: 'booking', sourceFaultId: str(d.faultId), eqId: matchId, eqCode: eqCode,
    eqName: str(d.eqName) || (matchEq && matchEq.name) || '',
    symptom: symptom, detail: str(d.detail), severity: str(d.severity),
    foundDate: str(d.foundDate), foundTime: str(d.foundTime),
    reporterName: str(d.reporterName), reporterEmail: str(d.reporterEmail), reporterOrg: str(d.reporterOrg),
    reportedAt: str(d.reportedAt) || new Date().toISOString(), sourceUrl: str(d.sourceUrl),
    status: 'new', createdAt: Date.now()
  };
  if (!dbSet('data/asset/incomingFaults/' + id, rec)) return { ok: false, error: 'บันทึกลงฐานข้อมูลไม่สำเร็จ — ตรวจสอบ DB_SECRET' };

  const settings = dbGet('data/asset/settings') || {};
  const to = (matchEq && matchEq.responsibleEmail && isEmail(matchEq.responsibleEmail)) ? matchEq.responsibleEmail
           : (isEmail(settings.notifyEmail) ? settings.notifyEmail : '');
  if (to) {
    MailApp.sendEmail({
      to: to,
      subject: '🛠 แจ้งเครื่องมือชำรุด: ' + rec.eqName + ' (' + eqCode + ')',
      htmlBody: inboundFaultHtml(rec, matchEq),
      name: SENDER_NAME
    });
  }
  return { ok: true, matched: !!matchId, eqId: matchId, emailedTo: to || null };
}
function inboundFaultHtml(r, eq) {
  return '<div style="font-family:Sarabun,Tahoma,sans-serif;font-size:14px;color:#2c3e50;max-width:640px">' +
    '<h2 style="color:#143f66;margin:0 0 6px">🛠 มีการแจ้งเครื่องมือชำรุดจากระบบจองใช้เครื่องมือ</h2>' +
    '<table style="border-collapse:collapse;width:100%">' +
    kvRow('รหัส/ชื่อเครื่องมือ', h(r.eqCode) + ' — ' + h(r.eqName)) +
    kvRow('ผู้รับผิดชอบในทะเบียน', eq ? h(eq.responsible || '-') : '<span style="color:#a1241a">ไม่พบครุภัณฑ์รหัสนี้ในทะเบียน — กรุณาตรวจสอบรหัสหรือเพิ่มครุภัณฑ์ก่อน</span>') +
    kvRow('อาการที่เสีย', h(r.symptom) + (r.detail ? '<br>' + h(r.detail) : '')) +
    kvRow('ความรุนแรง', h(r.severity) || '-') +
    kvRow('พบเมื่อ', (h(r.foundDate) + ' ' + h(r.foundTime)).trim()) +
    kvRow('ผู้แจ้ง', h(r.reporterName) + (r.reporterEmail ? ' (' + h(r.reporterEmail) + ')' : '') + (r.reporterOrg ? ' · ' + h(r.reporterOrg) : '')) +
    '</table>' +
    '<p style="margin-top:14px">เข้าระบบดูแลครุภัณฑ์เพื่อบันทึกเป็นรายการซ่อมอย่างเป็นทางการ' +
    (ADMIN_URL ? ': <a href="' + h(ADMIN_URL) + '" style="color:#1d5a8f">เปิดระบบดูแลครุภัณฑ์</a>' : '') + '</p>' +
    '</div>';
}
function kvRow(k, v) {
  return '<tr><th style="text-align:left;vertical-align:top;background:#e8f0f8;color:#143f66;border:1px solid #d0dbe6;padding:6px 10px;width:32%">' +
    k + '</th><td style="border:1px solid #d0dbe6;padding:6px 10px;vertical-align:top">' + v + '</td></tr>';
}
function dbSet(path, value) {
  const url = DB_URL + '/' + path + '.json?auth=' + encodeURIComponent(DB_SECRET);
  const res = UrlFetchApp.fetch(url, { method: 'put', contentType: 'application/json', payload: JSON.stringify(value), muteHttpExceptions: true });
  return res.getResponseCode() === 200;
}

function doGet() {
  return json({ ok: true, service: 'PSU:LASC asset maintenance mailer' });
}

function sendTest(who) {
  const to = who.email || RECIPIENTS_FALLBACK();
  MailApp.sendEmail({
    to: to,
    subject: '[ทดสอบ] ระบบดูแลครุภัณฑ์และเครื่องมือวิทยาศาสตร์ PSU:LASC',
    htmlBody: '<div style="font-family:Sarabun,Tahoma,sans-serif">สคริปต์ส่งอีเมลทำงานได้ตามปกติ ✅<br>ตรวจสิทธิ์เจ้าหน้าที่ผ่าน: ' + h(who.email || who.uid) + '</div>',
    name: SENDER_NAME
  });
  return { ok: true, sentTo: to, remainingToday: MailApp.getRemainingDailyQuota() };
}

/* ---------- สรุปแจ้งเตือน — เรียกจากปุ่มในหน้าเว็บ (ใช้แถวที่เว็บคำนวณมาให้แล้ว) ---------- */
function sendDigest(d, who) {
  const to = str(d.to) && isEmail(d.to) ? str(d.to) : (who.email || RECIPIENTS_FALLBACK());
  if (!to) return { ok: false, error: 'ไม่มีอีเมลผู้รับ — ตั้งค่า "อีเมลรับสรุปแจ้งเตือน" ในหน้าตั้งค่าก่อน' };
  const rows = Array.isArray(d.rows) ? d.rows : [];
  if (!rows.length) return { ok: false, error: 'ไม่มีรายการแจ้งเตือน' };
  MailApp.sendEmail({
    to: to,
    subject: '🔔 สรุปแจ้งเตือนครุภัณฑ์ที่ต้องติดตาม (' + rows.length + ' รายการ)',
    htmlBody: digestHtml(rows),
    name: SENDER_NAME
  });
  return { ok: true, sentTo: to, count: rows.length, remainingToday: MailApp.getRemainingDailyQuota() };
}
function digestHtml(rows) {
  const trs = rows.map(function (r) {
    const over = r.days < 0;
    const dueTxt = over ? ('เกินกำหนดมาแล้ว ' + Math.abs(r.days) + ' วัน') : ('อีก ' + r.days + ' วัน');
    return '<tr>' +
      '<td style="border:1px solid #d0dbe6;padding:6px 10px">' + h(r.code) + '</td>' +
      '<td style="border:1px solid #d0dbe6;padding:6px 10px">' + h(r.name) + '</td>' +
      '<td style="border:1px solid #d0dbe6;padding:6px 10px">' + h(r.type) + '</td>' +
      '<td style="border:1px solid #d0dbe6;padding:6px 10px">' + h(r.responsible || '-') + '</td>' +
      '<td style="border:1px solid #d0dbe6;padding:6px 10px;color:' + (over ? '#a1241a' : '#8a5a06') + '">' + h(dueTxt) + '</td>' +
      '</tr>';
  }).join('');
  return '<div style="font-family:Sarabun,Tahoma,sans-serif;font-size:14px;color:#2c3e50;max-width:680px">' +
    '<h2 style="color:#143f66;margin:0 0 10px">🔔 สรุปครุภัณฑ์ที่ต้องติดตาม</h2>' +
    '<table style="border-collapse:collapse;width:100%">' +
    '<tr style="background:#e8f0f8;color:#143f66"><th style="border:1px solid #d0dbe6;padding:6px 10px;text-align:left">รหัส</th>' +
    '<th style="border:1px solid #d0dbe6;padding:6px 10px;text-align:left">ชื่อ</th>' +
    '<th style="border:1px solid #d0dbe6;padding:6px 10px;text-align:left">ประเภท</th>' +
    '<th style="border:1px solid #d0dbe6;padding:6px 10px;text-align:left">ผู้รับผิดชอบ</th>' +
    '<th style="border:1px solid #d0dbe6;padding:6px 10px;text-align:left">กำหนด</th></tr>' + trs + '</table>' +
    (ADMIN_URL ? '<p style="margin-top:14px"><a href="' + h(ADMIN_URL) + '" style="background:#1d5a8f;color:#fff;padding:9px 16px;border-radius:6px;text-decoration:none">เปิดระบบ</a></p>' : '') +
    '</div>';
}

/* ---------- ส่งสรุปอัตโนมัติทุกวันด้วย Time-driven trigger (ไม่ต้องมีใครเปิดหน้าเว็บ) ---------- */
function sendDailyDigestAuto() {
  if (!DB_SECRET) throw new Error('ยังไม่ได้ตั้งค่า DB_SECRET — ดูวิธีที่คอมเมนต์ด้านบนของไฟล์นี้');
  const settings = dbGet('data/asset/settings') || {};
  const equipment = dbGet('data/asset/equipment') || {};
  const pm = dbGet('data/asset/pm') || {};
  const cal = dbGet('data/asset/calibration') || {};
  const to = settings.notifyEmail;
  if (!to || !isEmail(to)) return; // ไม่ได้ตั้งอีเมลผู้รับ ข้ามไป

  const today = Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyy-MM-dd');
  const leadPm = Number(settings.pmLeadDays || 14), leadCal = Number(settings.calLeadDays || 30);
  const rows = [];
  Object.keys(equipment).forEach(function (eqId) {
    const eq = equipment[eqId] || {};
    if (eq.retired) return;
    const pmDue = latestNextDue(pm[eqId], 'doneDate');
    if (pmDue) { const d = daysDiff(today, pmDue); if (d <= leadPm) rows.push({ code: eq.code, name: eq.name, responsible: eq.responsible, type: 'PM (บำรุงรักษา)', days: d }); }
    const calDue = latestNextDue(cal[eqId], 'date');
    if (calDue) { const d = daysDiff(today, calDue); if (d <= leadCal) rows.push({ code: eq.code, name: eq.name, responsible: eq.responsible, type: 'สอบเทียบ', days: d }); }
  });
  if (!rows.length) return;
  rows.sort(function (a, b) { return a.days - b.days; });
  MailApp.sendEmail({ to: to, subject: '🔔 สรุปแจ้งเตือนครุภัณฑ์ประจำวัน (' + rows.length + ' รายการ)', htmlBody: digestHtml(rows), name: SENDER_NAME });
}
function latestNextDue(map, dateField) {
  if (!map) return null;
  const list = Object.keys(map).map(function (k) { return map[k]; }).filter(function (r) { return !r.void; });
  list.sort(function (a, b) { return String(b[dateField] || '').localeCompare(String(a[dateField] || '')); });
  return list[0] ? list[0].nextDueDate || null : null;
}
function daysDiff(fromISO, toISO) { return Math.round((new Date(toISO + 'T00:00:00') - new Date(fromISO + 'T00:00:00')) / 86400000); }
function dbGet(path) {
  const url = DB_URL + '/' + path + '.json?auth=' + encodeURIComponent(DB_SECRET);
  const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) return null;
  try { return JSON.parse(res.getContentText()); } catch (e) { return null; }
}

/* ---------- ตรวจสิทธิ์เจ้าหน้าที่ ----------
   ถอดส่วน payload ของ ID token เพื่อเอา uid แล้วอ่าน allowed/{uid} จาก Realtime Database โดยใช้ token นั้นเอง
   ฐานข้อมูลตรวจลายเซ็นและวันหมดอายุของ token ให้ — token ปลอมหรือหมดอายุจะได้ 401 */
function verifyStaff(idToken) {
  if (!idToken || typeof idToken !== 'string') return null;
  const parts = idToken.split('.');
  if (parts.length !== 3) return null;
  let payload;
  try {
    let b = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    while (b.length % 4) b += '=';
    payload = JSON.parse(Utilities.newBlob(Utilities.base64Decode(b)).getDataAsString());
  } catch (e) { return null; }
  if (!payload || payload.aud !== FIREBASE_PROJECT || !payload.user_id) return null;
  if (payload.exp && payload.exp * 1000 < Date.now()) return null;

  const url = DB_URL + '/allowed/' + encodeURIComponent(payload.user_id) + '.json?auth=' + encodeURIComponent(idToken);
  const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) return null;
  const val = String(res.getContentText()).trim().replace(/^"|"$/g, '');
  if (val !== 'true' && val !== 'admin') return null;
  return { uid: payload.user_id, email: payload.email || '' };
}
function RECIPIENTS_FALLBACK() { return Session.getEffectiveUser().getEmail(); }

/* ---------- เครื่องมือ ---------- */
function json(obj) { return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON); }
function str(v, max) { const s = String(v == null ? '' : v).trim(); return max ? s.slice(0, max) : s.slice(0, 5000); }
function h(v) { return str(v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function isEmail(v) { return /^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/.test(String(v || '').trim()); }

/* กด Run ที่ฟังก์ชันนี้ครั้งแรกเพื่ออนุญาตสิทธิ์ (ส่งอีเมล + เชื่อมต่อฐานข้อมูล) แล้วตรวจกล่องจดหมาย */
function authorize() {
  UrlFetchApp.fetch(DB_URL + '/.json?shallow=true', { muteHttpExceptions: true });
  MailApp.sendEmail({
    to: Session.getEffectiveUser().getEmail(),
    subject: '[ทดสอบ] อนุญาตสิทธิ์สคริปต์ระบบดูแลครุภัณฑ์แล้ว',
    htmlBody: '<p>สคริปต์ส่งอีเมลได้ตามปกติ — ขั้นต่อไป Deploy เป็น Web app</p>',
    name: SENDER_NAME
  });
}
