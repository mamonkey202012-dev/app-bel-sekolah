import io
import os
from datetime import time, datetime, timezone, timedelta
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
from flask import Blueprint, request, jsonify, send_from_directory, send_file
from werkzeug.utils import secure_filename
from openpyxl import Workbook, load_workbook
from .database import get_db, simpan_jadwal_massal, BASE_DIR

api_bp = Blueprint('api', __name__)
AUDIO_FOLDER = os.path.join(BASE_DIR, 'static', 'audio')
os.makedirs(AUDIO_FOLDER, exist_ok=True)

ALLOWED_EXTENSIONS = ('.mp3', '.wav', '.ogg')

try:
    WITA = ZoneInfo("Asia/Makassar")
except ZoneInfoNotFoundError:
    WITA = timezone(timedelta(hours=8))

# Antrean perintah bunyi jarak jauh dari HP Admin ke Tablet Android
remote_queue = {
    "id": 0,
    "file_audio": "",
    "keterangan": "",
    "stop_signal": 0
}

HARI_VALID = {
    "senin": "Senin",
    "selasa": "Selasa",
    "rabu": "Rabu",
    "kamis": "Kamis",
    "jumat": "Jumat",
    "sabtu": "Sabtu",
    "minggu": "Minggu"
}


def normalisasi_jam(nilai_jam):
    if isinstance(nilai_jam, (time, datetime)):
        return nilai_jam.strftime("%H:%M")
    teks = str(nilai_jam).strip().replace('.', ':')
    bagian = teks.split(':')
    if len(bagian) >= 2 and bagian[0].isdigit() and bagian[1].isdigit():
        return f"{int(bagian[0]):02d}:{int(bagian[1]):02d}"
    return None


@api_bp.route('/api/waktu-server', methods=['GET'])
def waktu_server():
    sekarang = datetime.now(WITA)
    return jsonify({
        "timestamp_ms": int(sekarang.timestamp() * 1000),
        "zona": "WITA"
    })


@api_bp.route('/api/jadwal', methods=['GET'])
def list_jadwal():
    conn = get_db()
    rows = conn.execute('SELECT * FROM jadwal ORDER BY hari, jam ASC').fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])


@api_bp.route('/api/jadwal', methods=['POST'])
def tambah_jadwal():
    hari = request.form.get('hari')
    jam = request.form.get('jam')
    keterangan = request.form.get('keterangan')
    file_audio = request.form.get('file_audio_existing')

    if 'file_mp3' in request.files and request.files['file_mp3'].filename != '':
        f = request.files['file_mp3']
        if f.filename.lower().endswith(ALLOWED_EXTENSIONS):
            filename = secure_filename(f.filename)
            f.save(os.path.join(AUDIO_FOLDER, filename))
            file_audio = filename

    if not all([hari, jam, keterangan, file_audio]):
        return jsonify({'status': 'error', 'message': 'Data belum lengkap'}), 400

    conn = get_db()
    conn.execute(
        'INSERT INTO jadwal (hari, jam, keterangan, file_audio, aktif) VALUES (?, ?, ?, ?, 1)',
        (hari, jam, keterangan, file_audio)
    )
    conn.commit()
    conn.close()
    return jsonify({'status': 'ok'})


@api_bp.route('/api/upload-audio-massal', methods=['POST'])
def upload_audio_massal():
    files = request.files.getlist('files_audio')
    if not files or all(f.filename == '' for f in files):
        return jsonify({'status': 'error', 'message': 'Pilih minimal satu file audio (.mp3/.wav/.ogg)'}), 400

    berhasil = []
    dilewati = []

    for f in files:
        if f and f.filename:
            if f.filename.lower().endswith(ALLOWED_EXTENSIONS):
                filename = secure_filename(f.filename)
                f.save(os.path.join(AUDIO_FOLDER, filename))
                berhasil.append(filename)
            else:
                dilewati.append(f.filename)

    if not berhasil:
        return jsonify({'status': 'error', 'message': 'Tidak ada file audio valid yang diunggah'}), 400

    return jsonify({
        'status': 'ok',
        'jumlah': len(berhasil),
        'berhasil': berhasil,
        'dilewati': dilewati
    })


@api_bp.route('/api/audio/<path:filename>', methods=['DELETE'])
def hapus_audio(filename):
    safe_name = secure_filename(filename)
    target = os.path.join(AUDIO_FOLDER, safe_name)
    if os.path.exists(target):
        os.remove(target)
        return jsonify({'status': 'ok'})
    return jsonify({'status': 'error', 'message': 'File tidak ditemukan'}), 404


@api_bp.route('/api/template-excel', methods=['GET'])
def download_template_excel():
    wb = Workbook()
    ws = wb.active
    ws.title = "Jadwal Bel"

    ws.append(["hari", "jam", "keterangan", "file_audio", "aktif"])

    contoh = [
        ["Senin", "07:15", "Upacara Bendera", "upacara.mp3", 1],
        ["Senin", "08:00", "Masuk Jam Ke-1", "masuk_1.mp3", 1],
        ["Senin", "09:30", "Istirahat Pertama", "istirahat.mp3", 1],
        ["Jumat", "07:15", "Senam Pagi", "senam.mp3", 1],
        ["Jumat", "11:00", "Pulang Sekolah", "pulang.mp3", 1]
    ]
    for row in contoh:
        ws.append(row)

    output = io.BytesIO()
    wb.save(output)
    output.seek(0)
    return send_file(
        output,
        as_attachment=True,
        download_name="template_jadwal_bel.xlsx",
        mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    )


@api_bp.route('/api/import-excel', methods=['POST'])
def import_excel():
    if 'file_excel' not in request.files or request.files['file_excel'].filename == '':
        return jsonify({'status': 'error', 'message': 'Pilih file Excel (.xlsx) terlebih dahulu'}), 400

    mode = request.form.get('mode', 'tambah')
    f = request.files['file_excel']

    try:
        wb = load_workbook(f, data_only=True)
        ws = wb.active
        data_valid = []
        audio_tersedia = set(os.listdir(AUDIO_FOLDER))
        audio_hilang = set()

        for idx, row in enumerate(ws.iter_rows(values_only=True), start=1):
            if idx == 1:
                continue
            if not row or all(cell is None for cell in row):
                continue

            hari_raw = str(row[0] or '').strip().lower()
            hari = HARI_VALID.get(hari_raw)
            jam = normalisasi_jam(row[1]) if len(row) > 1 and row[1] is not None else None
            keterangan = str(row[2] or '').strip() if len(row) > 2 else ''
            file_audio = secure_filename(str(row[3] or '').strip()) if len(row) > 3 else ''
            aktif_raw = row[4] if len(row) > 4 and row[4] is not None else 1
            aktif = 1 if str(aktif_raw).strip() in ('1', 'True', 'true', 'aktif', 'ya') else 0

            if hari and jam and keterangan and file_audio:
                data_valid.append((hari, jam, keterangan, file_audio, aktif))
                if file_audio not in audio_tersedia:
                    audio_hilang.add(file_audio)

        if not data_valid:
            return jsonify({'status': 'error', 'message': 'Tidak ada baris jadwal valid di dalam file Excel'}), 400

        jumlah = simpan_jadwal_massal(data_valid, mode=mode)
        return jsonify({
            'status': 'ok',
            'jumlah': jumlah,
            'audio_hilang': sorted(list(audio_hilang))
        })
    except Exception as e:
        return jsonify({'status': 'error', 'message': f'Gagal membaca Excel: {str(e)}'}), 400


@api_bp.route('/api/jadwal/<int:id>/toggle', methods=['POST'])
def toggle_jadwal(id):
    conn = get_db()
    conn.execute('UPDATE jadwal SET aktif = CASE WHEN aktif = 1 THEN 0 ELSE 1 END WHERE id = ?', (id,))
    conn.commit()
    conn.close()
    return jsonify({'status': 'ok'})


@api_bp.route('/api/jadwal/<int:id>', methods=['DELETE'])
def hapus_jadwal(id):
    conn = get_db()
    conn.execute('DELETE FROM jadwal WHERE id = ?', (id,))
    conn.commit()
    conn.close()
    return jsonify({'status': 'ok'})


@api_bp.route('/api/salin-jadwal', methods=['POST'])
def salin_jadwal():
    data = request.get_json(silent=True) or {}
    dari_hari = data.get('dari_hari')
    ke_hari = data.get('ke_hari')
    if not dari_hari or not ke_hari or dari_hari == ke_hari:
        return jsonify({'status': 'error', 'message': 'Hari asal dan tujuan tidak valid'}), 400

    conn = get_db()
    sumber = conn.execute('SELECT jam, keterangan, file_audio, aktif FROM jadwal WHERE hari = ?', (dari_hari,)).fetchall()
    for row in sumber:
        conn.execute(
            'INSERT INTO jadwal (hari, jam, keterangan, file_audio, aktif) VALUES (?, ?, ?, ?, ?)',
            (ke_hari, row['jam'], row['keterangan'], row['file_audio'], row['aktif'])
        )
    conn.commit()
    conn.close()
    return jsonify({'status': 'ok', 'jumlah': len(sumber)})


@api_bp.route('/api/mode-libur', methods=['GET', 'POST'])
def mode_libur():
    conn = get_db()
    if request.method == 'POST':
        data = request.get_json(silent=True) or {}
        nilai = '1' if data.get('libur') else '0'
        conn.execute("UPDATE pengaturan SET nilai = ? WHERE kunci = 'mode_libur'", (nilai,))
        conn.commit()
    row = conn.execute("SELECT nilai FROM pengaturan WHERE kunci = 'mode_libur'").fetchone()
    conn.close()
    return jsonify({'libur': row['nilai'] == '1'})


@api_bp.route('/api/audio-list', methods=['GET'])
def list_audio():
    files = [f for f in os.listdir(AUDIO_FOLDER) if f.lower().endswith(ALLOWED_EXTENSIONS)]
    return jsonify(sorted(files))


@api_bp.route('/api/bunyi-sekarang', methods=['POST'])
def bunyi_sekarang():
    data = request.get_json(silent=True) or {}
    file_audio = data.get('file_audio')
    if not file_audio:
        return jsonify({'status': 'error'}), 400
    remote_queue['id'] += 1
    remote_queue['file_audio'] = file_audio
    remote_queue['keterangan'] = data.get('keterangan', 'Bel Manual')
    return jsonify({'status': 'ok', 'queue': remote_queue})


@api_bp.route('/api/stop-suara', methods=['POST'])
def stop_suara():
    remote_queue['stop_signal'] += 1
    return jsonify({'status': 'ok'})


@api_bp.route('/api/cek-antrean', methods=['GET'])
def cek_antrean():
    return jsonify(remote_queue)


@api_bp.route('/static/audio/<path:filename>')
def serve_audio(filename):
    return send_from_directory(AUDIO_FOLDER, filename)