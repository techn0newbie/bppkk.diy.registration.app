// ============================================================
//  BPPKK DIY REGISTRATION APPS 2026 — Google Apps Script
// ============================================================

// ============================================================
//  ⚙️  CONFIGURATION TABLE
// ============================================================
const SHEET_NAME       = 'participants';
const ATTENDANCE_SHEET = 'attendance';
const MAX_QUOTA        = 1011;
const MAX_PER_PHONE    = 5;
const ID_PREFIX        = '411';
const QUOTA_PER_TIKET  = { platinum: 96, gold: 122, silver: 143, bronze: 650 };
// ============================================================

function doGet(e) {
  const action = e.parameter.action;
  let result;

  try {
    if      (action === 'quota')    result = getQuota();
    else if (action === 'register') result = registerPeserta(e.parameter);
    else if (action === 'checkin')  result = checkIn(e.parameter.qr);
    else if (action === 'lookup')   result = lookupPeserta(e.parameter.query);
    else if (action === 'verify')   result = verifyPayment(e.parameter.id);
    else result = { status: 'error', message: 'Action tidak dikenal' };
  } catch (err) {
    result = { status: 'error', message: err.toString() };
  }

  return ContentService
    .createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

// ----------------------------------------------------------
//  1. CEK KUOTA (per kategori)
// ----------------------------------------------------------
function getQuota() {
  const sheet = getSheet(SHEET_NAME);
  const data  = sheet.getDataRange().getValues();

  const count = { platinum: 0, gold: 0, silver: 0, bronze: 0, total: 0 };
  for (let i = 1; i < data.length; i++) {
    const statusBayar = String(data[i][6]).trim().toLowerCase();
    if (statusBayar !== 'lunas') continue; // only count paid participants
    const tiket = (data[i][5] || 'platinum').toString().trim().toLowerCase();
    if (count[tiket] !== undefined) count[tiket]++;
    count.total++;
  }

  return {
    platinum:  count.platinum,
    gold:   count.gold,
    silver:  count.silver,
    bronze:  count.bronze,
    total: count.total,
    max:   MAX_QUOTA
  };
}

// ----------------------------------------------------------
//  2. REGISTRASI PESERTA
// ----------------------------------------------------------
function registerPeserta(params) {
  const sheet = getSheet(SHEET_NAME);

  const nama  = (params.nama  || '').trim();
  const raw   = (params.phone || '').trim().replace(/\D/g, ''); // strip all non-digits
  // Normalize to always start with 0
  let phone;
  if (raw.startsWith('62'))      phone = '0' + raw.slice(2);
  else if (raw.startsWith('0'))  phone = raw;
  else                           phone = '0' + raw;
  const kota  = (params.kota  || '').trim();
  const pd    = (params.pd    || '').trim();
  const tiket = (params.tiket || 'bronze').toLowerCase().trim();
  /*const alat  = (params.alat  || 'tidak').trim();*/

  if (!nama || !phone || !kota) {
    return { status: 'error', message: 'Nama, nomor HP, dan kota wajib diisi' };
  }

  // Cek kuota — gunakan total semua registrasi (lunas + belum bayar)
  const allData  = sheet.getDataRange().getValues();
  const allCount = { platinum: 0, gold: 0, silver: 0, bronze: 0, total: 0 };
  for (let i = 1; i < allData.length; i++) {
    const t = (allData[i][5] || 'bronze').toString().trim().toLowerCase();
    if (allCount[t] !== undefined) allCount[t]++;
    allCount.total++;
  }
  const maxTiket = QUOTA_PER_TIKET[tiket] || 0;
  if ((allCount[tiket] || 0) >= maxTiket) {
    return { status: 'full', tiket, message: 'Kuota ' + tiket.toUpperCase() + ' sudah penuh' };
  }
  if (allCount.total >= MAX_QUOTA) {
    return { status: 'full', message: 'Kuota total sudah penuh' };
  }

  // Cek jumlah registrasi per nomor HP (max 5)
  const normalizeNum = n => String(n).replace(/\D/g,'').replace(/^62/, '').replace(/^0/, '');
  const data = sheet.getDataRange().getValues();
  let phoneCount = 0;
  for (let i = 1; i < data.length; i++) {
    if (normalizeNum(data[i][2]) === normalizeNum(phone)) {
      phoneCount++;
    }
  }
  if (phoneCount >= MAX_PER_PHONE) {
    return { status: 'duplicate', message: 'Nomor HP ini sudah digunakan untuk ' + MAX_PER_PHONE + ' pendaftaran. Maksimal ' + MAX_PER_PHONE + ' per nomor HP.' };
  }

  const id        = generateId(sheet);
  const timestamp = now();

  // Kolom: ID | Nama | No HP | Kota | PD | Tiket | Status Bayar | Tgl Daftar | Status Hadir | Tgl Hadir | Tgl Verifikasi
  const newRow = sheet.getLastRow() + 1;
  sheet.appendRow([id, nama, phone, kota, pd, /*alat,*/ tiket, 'Belum Bayar', timestamp, '', 'Belum Hadir', '']);
  // Force phone column (col 3) to text format so leading 0 is preserved
  sheet.getRange(newRow, 3).setNumberFormat('@');

  return { status: 'success', id, nama, phone, kota, pd, /*alat,*/ tiket, timestamp };
}

// ----------------------------------------------------------
//  3. CHECK-IN / ABSENSI
// ----------------------------------------------------------
function checkIn(qrText) {
  if (!qrText) return { status: 'error', message: 'QR tidak valid' };

  const searchId = qrText.split('|')[0].trim().toUpperCase();
  const sheet    = getSheet(SHEET_NAME);
  const data     = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (data[i][0].toString().toUpperCase() === searchId) {
      const nama        = data[i][1];
      const phone       = data[i][2];
      const pd          = data[i][4];
      /*const alat        = data[i][5];*/
      const tiket       = String(data[i][5]).trim();
      const statusBayar = data[i][6];
      const statusHadir = data[i][9];

      if (statusBayar !== 'Lunas') {
        return { status: 'unpaid', nama, id: searchId, message: 'Pembayaran belum dikonfirmasi' };
      }
      if (statusHadir === 'Hadir') {
        return { status: 'already', nama, id: searchId, pd, tiket, checkin_time: data[i][10] };
      }

      const waktu = now();
      sheet.getRange(i + 1, 10).setValue('Hadir');
      sheet.getRange(i + 1, 11).setValue(waktu);
      getSheet(ATTENDANCE_SHEET).appendRow([searchId, nama, phone, pd, /*alat,*/ tiket, waktu]);

      return { status: 'success', nama, id: searchId, pd, tiket, checkin_time: waktu };
    }
  }

  return { status: 'error', message: 'ID tidak ditemukan: ' + searchId };
}

// ----------------------------------------------------------
//  4. LOOKUP — returns all matches for phone, or single match for ID
// ----------------------------------------------------------
function lookupPeserta(query) {
  if (!query) return { status: 'error', message: 'Query kosong' };

  const q          = query.trim().toUpperCase();
  const sheet      = getSheet(SHEET_NAME);
  const data       = sheet.getDataRange().getValues();
  const queryClean = query.trim().replace(/\D/g, '');
  const results    = [];

  for (let i = 1; i < data.length; i++) {
    const id         = data[i][0].toString().toUpperCase();
    const phone      = data[i][2].toString();
    const phoneClean = phone.replace(/\D/g, '');

    const matchId    = id === q;
    const matchPhone = phone === query.trim() || (queryClean.length >= 8 && phoneClean === queryClean);

    if (matchId || matchPhone) {
      results.push({
        id:      String(data[i][0]),
        nama:    data[i][1],
        phone:   String(data[i][2]),
        kota:    data[i][3],
        pd:      data[i][4],
        /*alat:    data[i][5],*/
        tiket:   String(data[i][5]).trim(),
        payment: data[i][6]
      });
      // If matched by ID, return immediately — no need to scan further
      if (matchId) break;
    }
  }

  if (results.length === 0) return { status: 'notfound', message: 'Peserta tidak ditemukan' };
  return { status: 'found', results: results };
}

// ----------------------------------------------------------
//  5. VERIFIKASI PEMBAYARAN
// ----------------------------------------------------------
function verifyPayment(id) {
  if (!id) return { status: 'error', message: 'ID tidak boleh kosong' };

  const searchId = id.trim().toUpperCase();
  const sheet    = getSheet(SHEET_NAME);
  const data     = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (data[i][0].toString().toUpperCase() === searchId) {
      const nama    = data[i][1];
      const phone   = data[i][2];
      const tiket   = String(data[i][5]).trim();
      const payment = data[i][6];

      if (payment === 'Lunas') {
        return { status: 'already', nama, id: data[i][0], tiket, verified_time: data[i][9] };
      }

      const waktu = now();
      sheet.getRange(i + 1, 7).setValue('Lunas');
      sheet.getRange(i + 1, 9).setValue(waktu);

      return { status: 'success', nama, id: String(data[i][0]), phone: String(data[i][2]), tiket, verified_time: waktu };
    }
  }

  return { status: 'error', message: 'ID tidak ditemukan: ' + searchId };
}

// ----------------------------------------------------------
//  HELPER: Timestamp WIB
// ----------------------------------------------------------
function now() {
  return new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
}

// ----------------------------------------------------------
//  HELPER: Generate unique ID based on last existing ID
// ----------------------------------------------------------
function generateId(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return ID_PREFIX + '0001'; // no data yet

  // Find the highest existing ID number to avoid duplicates
  const ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  let maxNum = 0;
  ids.forEach(function(row) {
    const id  = String(row[0]).replace(/\D/g, '');
    const num = parseInt(id.slice(-4)) || 0;
    if (num > maxNum) maxNum = num;
  });

  return ID_PREFIX + String(maxNum + 1).padStart(4, '0');
}

// ----------------------------------------------------------
//  HELPER: Ambil atau buat sheet
// ----------------------------------------------------------
function getSheet(name) {
  const ss  = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    if (name === SHEET_NAME) {
      sheet.appendRow(['ID','Nama','No HP','Kota','Persekutuan Doa',/*'Alat Bantu',*/'Tiket','Status Bayar','Tgl Daftar','Tgl Verifikasi','Status Hadir','Tgl Hadir']);
      sheet.setFrozenRows(1);
      sheet.getRange(1,1,1,12).setFontWeight('bold').setBackground('#085041').setFontColor('white');
      sheet.setColumnWidths(1,12,[90,200,130,120,160,70,110,110,160,110,160,160]);
    } else if (name === ATTENDANCE_SHEET) {
      sheet.appendRow(['ID','Nama','No HP','Persekutuan Doa','Tiket','Tgl Hadir']);
      sheet.setFrozenRows(1);
      sheet.getRange(1,1,1,6).setFontWeight('bold').setBackground('#1D9E75').setFontColor('white');
    }
  }
  return sheet;
}
