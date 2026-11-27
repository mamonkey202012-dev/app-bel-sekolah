# 🔔 Aplikasi Bel Sekolah Otomatis (WITA)

Aplikasi web **Bel Sekolah Otomatis** berbasis **Flask + SQLite** yang dirancang khusus untuk dijalankan di **STB Armbian** dengan pengelolaan **aaPanel**, serta menggunakan **Tablet Android** sebagai terminal speaker yang terhubung ke amplifier/pengeras suara sekolah.

---

## ✨ Fitur Utama

- **Jam Presisi Zona WITA (`Asia/Makassar`, UTC+8)** — Tersinkronisasi langsung dengan waktu server STB Armbian tanpa terpengaruh jam lokal perangkat.
- **Mode Admin & Mode Speaker Tablet (`/?mode=speaker`)** — Tampilan khusus Tablet Android yang menyembunyikan menu pengaturan admin dan menampilkan jadwal hari ini + tombol bel cepat.
- **Keep-Alive Latar Belakang Android** — Menggunakan audio WAV hening dinamis, `Wake Lock API`, dan `MediaSession API` agar browser Android tidak tertidur saat menunggu jadwal bel.
- **Kontrol Jarak Jauh dari HP Admin** — Bunyikan bel manual, hentikan suara bel seketika, dan aktifkan/nonaktifkan **Mode Libur** dari HP atau PC dalam jaringan yang sama.
- **Bank Audio Multi-Upload** — Upload banyak file `.mp3`, `.wav`, atau `.ogg` sekaligus (batas hingga 100 MB).
- **Import Jadwal Massal via Excel (`.xlsx`)** — Tersedia tombol unduh template Excel, mode tambah/timpa jadwal, serta fitur **Salin Jadwal Antar Hari**.

---

## 📁 Struktur Proyek

```text
app-bel-sekolah/
├── app.py                  # Entry point Flask (port 5000, zona waktu Asia/Makassar)
├── requirements.txt        # Daftar dependensi Python
├── modules/
│   ├── database.py         # Inisialisasi & helper database SQLite
│   └── routes_api.py       # Endpoint REST API (jadwal, audio, Excel, remote trigger)
├── static/
│   ├── audio/              # Penyimpanan file audio bel (.mp3 / .wav / .ogg)
│   └── js/
│       └── bell-engine.js  # Mesin waktu WITA, audio player, dan sinkronisasi remote
├── templates/
│   └── index.html          # Antarmuka Admin & Mode Speaker Tablet
└── data/
    └── bel_sekolah.db      # Database SQLite jadwal & pengaturan
```

---

## 🛠️ Prasyarat di STB Armbian

- STB (misalnya HG680P / B860H / Armbian Debian atau Ubuntu ARM64) terhubung ke jaringan LAN/Wi-Fi sekolah.
- Akses SSH (`root` atau user dengan `sudo`).
- **aaPanel** sudah terpasang dan dapat diakses melalui browser.
- Python 3.9+ (`python3`, `python3-pip`, `python3-venv`) dan `git`.

---

## 🚀 Langkah 1: Persiapan STB Armbian

Login ke STB Armbian melalui SSH, lalu atur zona waktu server ke **WITA (`Asia/Makassar`)** dan pasang paket yang dibutuhkan:

```bash
# 1. Atur zona waktu ke WITA (UTC+8)
sudo timedatectl set-timezone Asia/Makassar
timedatectl status

# 2. Pastikan sinkronisasi jam otomatis (NTP) aktif
sudo timedatectl set-ntp true

# 3. Update repository dan install Git + Python venv
sudo apt update
sudo apt install -y git python3 python3-pip python3-venv
```

---

## 📥 Langkah 2: Clone & Instalasi Aplikasi di STB Armbian

Simpan proyek di direktori default web aaPanel (`/www/wwwroot`):

```bash
cd /www/wwwroot
git clone https://github.com/mamonkey202012-dev/app-bel-sekolah.git
cd /www/wwwroot/app-bel-sekolah

# Buat virtual environment Python
python3 -m venv .venv
source .venv/bin/activate

# Install dependensi aplikasi + gunicorn untuk production
pip install --upgrade pip
pip install -r requirements.txt gunicorn

# Inisialisasi database SQLite (membuat data/bel_sekolah.db jika belum ada)
python3 -c "from modules.database import init_db; init_db(); print('Database siap!')"
```

### Uji Coba Awal (Opsional)

Pastikan aplikasi berjalan tanpa error:

```bash
python3 app.py
```

Jika muncul pesan Flask berjalan di `http://0.0.0.0:5000`, tekan `Ctrl + C` untuk menghentikannya, lalu lanjutkan ke integrasi aaPanel di bawah.

---

## ⚙️ Langkah 3: Menghubungkan ke aaPanel

Anda bisa menjalankan aplikasi melalui **Website → Python Project** (Opsi A) atau **Supervisor Manager** (Opsi B).

> **⚠️ PENTING (Wajib 1 Worker):**
> Antrean perintah jarak jauh (`remote_queue`) antara HP Admin dan Tablet Android disimpan di memori proses Python. Oleh karena itu, saat menjalankan dengan Gunicorn **wajib menggunakan 1 worker (`-w 1`)** dengan multi-thread (`--threads 4`). Jangan gunakan lebih dari 1 worker agar tombol *Bel Manual* dan *Hentikan Suara* dari HP Admin selalu terbaca oleh Tablet.

### Opsi A — Menggunakan Python Project di aaPanel (Direkomendasikan)

1. Login ke dashboard **aaPanel**.
2. Buka **App Store**, cari dan pasang **Nginx** (jika belum) serta **Python Manager** (opsional, pada aaPanel versi terbaru sudah tersedia di menu **Website → Python Project**).
3. Masuk ke menu **Website → Python Project → Add Python Project**:
   - **Path:** `/www/wwwroot/app-bel-sekolah`
   - **Name:** `app-bel-sekolah`
   - **Run opt:** `gunicorn` (atau `python`)
   - **Port:** `5000`
   - **Startup file / Module:** `app.py` (objek `app`)
   - **Workers / Processes:** `1`
   - **Run user:** `www` (pastikan folder `data/` dan `static/audio/` bisa ditulis oleh user `www`, lihat perintah izin folder di bawah)
   - Centang **Start on boot** agar otomatis menyala saat STB restart.
4. Klik **Confirm / Submit** dan pastikan status proyek **Running**.

### Opsi B — Menggunakan Supervisor Manager di aaPanel (Ringan & Stabil untuk STB)

1. Di aaPanel, buka **App Store** → install **Supervisor Manager**.
2. Buka pengaturan **Supervisor Manager** → **Add Daemon**:
   - **Name:** `bel-sekolah`
   - **Run User:** `root` (atau `www`)
   - **Run Dir:** `/www/wwwroot/app-bel-sekolah`
   - **Start Command:**
     ```bash
     /www/wwwroot/app-bel-sekolah/.venv/bin/gunicorn -w 1 --threads 4 -b 127.0.0.1:5000 app:app
     ```
3. Klik **Confirm** dan pastikan statusnya **Running**.

### Atur Izin Folder (Jika Dijalankan sebagai User `www`)

Agar upload file audio MP3 dan penyimpanan database SQLite tidak terkena *Permission Denied*:

```bash
sudo chown -R www:www /www/wwwroot/app-bel-sekolah
sudo chmod -R 755 /www/wwwroot/app-bel-sekolah
sudo chmod -R 775 /www/wwwroot/app-bel-sekolah/data /www/wwwroot/app-bel-sekolah/static/audio
```

### Menghubungkan ke Domain / IP via Nginx Reverse Proxy di aaPanel

Agar aplikasi dapat diakses melalui port `80` (tanpa mengetik `:5000`) seperti `http://<IP-STB>` atau `http://bel.sekolah.local`:

1. Masuk ke menu **Website → PHP Project → Add site**:
   - **Domain name:** masukkan IP STB (misal `192.168.1.50`) atau domain lokal (misal `bel.sekolah.local`)
   - **PHP version:** pilih **Static**
   - Klik **Submit**.
2. Klik nama website yang baru dibuat → buka tab **Reverse Proxy → Add Reverse Proxy**:
   - **Proxy Name:** `bel-sekolah`
   - **Target URL:** `http://127.0.0.1:5000`
   - **Sent Domain:** `$host`
   - Klik **Submit**.
3. **Naikkan batas upload Nginx menjadi 100 MB** (agar multi-upload MP3 tidak error `413`):
   - Masih di pengaturan website tersebut, buka tab **Config file**, lalu tambahkan di dalam blok `server { ... }`:
     ```nginx
     client_max_body_size 100M;
     ```
   - Klik **Save**.
4. **Buka Port di Firewall aaPanel:**
   - Buka menu **Security → Firewall**.
   - Pastikan port `80` (untuk akses via Nginx) sudah terbuka. Jika ingin akses langsung tanpa Nginx, buka juga port `5000`.

---

## 📱 Langkah 4: Cara Penggunaan

### 1. Perangkat Admin (HP / Laptop)
- Buka `http://<IP-STB>` (atau `http://<IP-STB>:5000`).
- **Langkah awal:** Upload semua file MP3 bel di menu **1. Bank Audio Bel**.
- Tambahkan jadwal satuan atau unduh template Excel di menu **2. Import Jadwal Massal via Excel (`.xlsx`)**.
- Gunakan panel **Bel Manual / Bunyi Cepat**, **Mode Libur**, dan **Hentikan Suara Sekarang** untuk kontrol jarak jauh.

### 2. Tablet Android (Terhubung ke Amplifier / Speaker Sekolah)
- Sambungkan kabel audio (AUX/Bluetooth) dari Tablet Android ke amplifier sekolah.
- Buka Chrome di Tablet dan akses:
  ```text
  http://<IP-STB>/?mode=speaker
  ```
- Tekan tombol merah besar **"🔇 KLIK DI SINI PADA TABLET ANDROID UNTUK AKTIFKAN SPEAKER"** hingga berubah menjadi hijau (**🔊 TERMINAL SPEAKER AKTIF**).
- **Tips Android agar tidak mati di latar belakang:**
  - Matikan *Battery Optimization / Penghemat Baterai* untuk Google Chrome di pengaturan Android.
  - Pastikan volume media tablet maksimal dan tidak dalam mode senyap.

---

## 🔄 Update Aplikasi dari GitHub di STB Armbian

Jika ada pembaruan kode di GitHub, jalankan perintah berikut di STB:

```bash
cd /www/wwwroot/app-bel-sekolah

# Backup database terlebih dahulu (disarankan)
cp data/bel_sekolah.db data/bel_sekolah.db.bak

# Ambil pembaruan terbaru
git pull origin main

# Install jika ada dependensi baru
source .venv/bin/activate
pip install -r requirements.txt
```

Setelah itu, **Restart** proyek `app-bel-sekolah` melalui **Python Project** atau **Supervisor Manager** di aaPanel.

---

## 🧩 Troubleshooting

| Masalah | Solusi |
| :--- | :--- |
| **Error `413 Request Entity Too Large` saat upload MP3** | Tambahkan `client_max_body_size 100M;` pada Config Nginx di aaPanel lalu reload Nginx. |
| **Tombol Bel Manual / Stop dari HP Admin tidak memicu Tablet** | Pastikan Gunicorn berjalan dengan **`-w 1`** (1 worker saja) dan tombol Speaker di Tablet sudah berwarna hijau. |
| **Jam tidak sesuai WITA** | Jalankan `sudo timedatectl set-timezone Asia/Makassar && sudo timedatectl set-ntp true` di STB, lalu restart aplikasi di aaPanel. |
| **Gagal simpan jadwal / upload audio (`Permission Denied`)** | Jalankan ulang perintah `chown -R www:www` dan `chmod -R 775` pada folder `data/` dan `static/audio/`. |
| **Halaman tidak bisa diakses dari HP/Tablet** | Pastikan HP/Tablet dan STB berada di jaringan Wi-Fi/LAN yang sama, dan port `80` / `5000` sudah dibuka di menu **Security** aaPanel. |
