import os
import sqlite3

BASE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
DATA_DIR = os.path.join(BASE_DIR, 'data')
os.makedirs(DATA_DIR, exist_ok=True)
DB_PATH = os.path.join(DATA_DIR, 'bel_sekolah.db')


def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    conn = get_db()
    conn.execute('''
        CREATE TABLE IF NOT EXISTS jadwal (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            hari TEXT NOT NULL,
            jam TEXT NOT NULL,
            keterangan TEXT NOT NULL,
            file_audio TEXT NOT NULL,
            aktif INTEGER DEFAULT 1
        )
    ''')
    conn.execute('''
        CREATE TABLE IF NOT EXISTS pengaturan (
            kunci TEXT PRIMARY KEY,
            nilai TEXT NOT NULL
        )
    ''')
    conn.execute("INSERT OR IGNORE INTO pengaturan (kunci, nilai) VALUES ('mode_libur', '0')")
    conn.commit()
    conn.close()


def simpan_jadwal_massal(daftar_baris, mode='tambah'):
    """
    Menyimpan banyak baris jadwal dari Excel sekaligus ke SQLite.
    mode='timpa' akan mengosongkan tabel jadwal lama sebelum memasukkan data baru.
    """
    conn = get_db()
    try:
        if mode == 'timpa':
            conn.execute('DELETE FROM jadwal')

        conn.executemany(
            'INSERT INTO jadwal (hari, jam, keterangan, file_audio, aktif) VALUES (?, ?, ?, ?, ?)',
            daftar_baris
        )
        conn.commit()
        return len(daftar_baris)
    finally:
        conn.close()