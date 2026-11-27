const namaHari = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
const mainPlayer = document.getElementById('mainPlayer');
const keepAlivePlayer = document.getElementById('keepAlivePlayer');

// Deteksi apakah dibuka di Tablet Android (?mode=speaker)
const urlParams = new URLSearchParams(window.location.search);
const isSpeakerViewOnly = urlParams.get('mode') === 'speaker';
if (isSpeakerViewOnly) {
    document.body.classList.add('speaker-mode');
    const gridKontrol = document.getElementById('gridKontrolUtama');
    if (gridKontrol) gridKontrol.style.gridTemplateColumns = '1fr';
}

let isTerminalAudio = false;
let daftarJadwal = [];
let isModeLibur = false;
let lastScheduledKey = "";
let lastRemoteQueueId = null;
let lastStopSignal = null;
let audioCtx = null;
let selisihWaktuMs = 0;

// Sinkronisasi jam presisi dengan server aaPanel Armbian (WITA)
async function sinkronWaktuServer() {
    try {
        const t0 = Date.now();
        const res = await fetch('/api/waktu-server');
        const data = await res.json();
        const t1 = Date.now();
        const latensi = (t1 - t0) / 2;
        selisihWaktuMs = (data.timestamp_ms + latensi) - t1;
    } catch (e) { }
}

// Konversi waktu saat ini mutlak ke zona WITA (UTC+8)
function getWaktuWITA() {
    const utcMs = Date.now() + selisihWaktuMs;
    const witaDate = new Date(utcMs + (8 * 3600 * 1000));
    const hari = namaHari[witaDate.getUTCDay()];
    const jam = String(witaDate.getUTCHours()).padStart(2, '0');
    const menit = String(witaDate.getUTCMinutes()).padStart(2, '0');
    const detik = witaDate.getUTCSeconds();
    const detikStr = String(detik).padStart(2, '0');

    return {
        hari,
        jamMenit: `${jam}:${menit}`,
        jamLengkap: `${jam}:${menit}:${detikStr} WITA`,
        detik
    };
}

// Membuat WAV hening 2 detik secara dinamis untuk menjaga proses latar belakang Android
function createSilentWavDataUri() {
    const sampleRate = 8000;
    const numSamples = sampleRate * 2;
    const buffer = new ArrayBuffer(44 + numSamples);
    const view = new DataView(buffer);
    const writeStr = (offset, str) => {
        for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
    };
    writeStr(0, 'RIFF');
    view.setUint32(4, 36 + numSamples, true);
    writeStr(8, 'WAVE');
    writeStr(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate, true);
    view.setUint16(32, 1, true);
    view.setUint16(34, 8, true);
    writeStr(36, 'data');
    view.setUint32(40, numSamples, true);
    for (let i = 44; i < 44 + numSamples; i++) view.setUint8(i, 128);

    let binary = '';
    const bytes = new Uint8Array(buffer);
    for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
    return 'data:audio/wav;base64,' + btoa(binary);
}

// 1. Mengaktifkan Mode Speaker & Mengunci Proses Latar Belakang di Tablet Android
async function aktifkanTerminalAudio() {
    try {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (AudioContextClass && !audioCtx) {
            audioCtx = new AudioContextClass();
            if (audioCtx.state === 'suspended') await audioCtx.resume();
        }

        keepAlivePlayer.src = createSilentWavDataUri();
        keepAlivePlayer.volume = 0.01;
        await keepAlivePlayer.play();

        mainPlayer.src = createSilentWavDataUri();
        await mainPlayer.play();
        mainPlayer.pause();

        if ('mediaSession' in navigator) {
            navigator.mediaSession.metadata = new MediaMetadata({
                title: 'Terminal Bel Sekolah Aktif',
                artist: 'Server aaPanel Armbian',
                album: 'Sistem Bel Otomatis WITA'
            });
        }

        if ('wakeLock' in navigator) {
            navigator.wakeLock.request('screen').catch(() => { });
        }

        isTerminalAudio = true;
        localStorage.setItem('terminal_audio_aktif', '1');

        const btn = document.getElementById('btnTerminal');
        btn.classList.add('aktif');
        btn.innerText = "🔊 TERMINAL SPEAKER AKTIF (BERJALAN DI LATAR BELAKANG)";
    } catch (e) {
        alert("Sentuh layar tablet terlebih dahulu lalu tekan tombol ini lagi.\nDetail: " + e.message);
    }
}

document.addEventListener('visibilitychange', () => {
    if (isTerminalAudio && keepAlivePlayer.paused) {
        keepAlivePlayer.play().catch(() => { });
    }
});

// 2. Memutar File Audio Bel di Tablet Android
function putarAudioLokal(filename, label) {
    const statusEl = document.getElementById('statusBunyi');
    statusEl.innerText = "🔔 SEDANG BERBUNYI: " + label;

    mainPlayer.pause();
    mainPlayer.currentTime = 0;
    mainPlayer.src = "/static/audio/" + encodeURIComponent(filename) + "?t=" + Date.now();
    mainPlayer.volume = 1.0;

    mainPlayer.play().catch(err => {
        statusEl.innerText = "⚠️ Gagal memutar audio (klik tombol merah di atas terlebih dahulu)";
        console.error(err);
    });

    mainPlayer.onended = () => {
        statusEl.innerText = "";
    };
}

function hentikanAudioLokal() {
    mainPlayer.pause();
    mainPlayer.currentTime = 0;
    document.getElementById('statusBunyi').innerText = "";
}

// 3. Kontrol Bunyi & Stop (Bekerja baik di Tablet Klien maupun HP Admin)
async function bunyikanBel(filename, label) {
    if (isSpeakerViewOnly || isTerminalAudio) {
        if (!isTerminalAudio) {
            await aktifkanTerminalAudio();
        }
        putarAudioLokal(filename, label);
    } else {
        await fetch('/api/bunyi-sekarang', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ file_audio: filename, keterangan: label })
        });
    }
}

async function hentikanSuaraSekarang() {
    hentikanAudioLokal();
    await fetch('/api/stop-suara', { method: 'POST' });
}

// 4. Mesin Waktu Presisi WITA (Cek Jadwal Tiap 1 Detik)
setInterval(() => {
    const wita = getWaktuWITA();

    document.getElementById('clock').innerText = wita.jamLengkap;
    document.getElementById('hariIni').innerText = isModeLibur
        ? `Hari: ${wita.hari} — ⛔ MODE LIBUR AKTIF (Bel Otomatis Dijeda)`
        : `Hari: ${wita.hari} — ✅ Jadwal Normal (Zona WITA)`;

    if (!isModeLibur && wita.detik === 0 && isTerminalAudio) {
        const key = `${wita.hari}-${wita.jamMenit}`;
        if (lastScheduledKey !== key) {
            const cocok = daftarJadwal.find(j => j.aktif === 1 && j.hari === wita.hari && j.jam === wita.jamMenit);
            if (cocok) {
                lastScheduledKey = key;
                putarAudioLokal(cocok.file_audio, `${cocok.keterangan} (${cocok.jam} WITA)`);
            }
        }
    }
}, 1000);

// 5. Polling Perintah Jarak Jauh Tiap 2 Detik
setInterval(async () => {
    try {
        const res = await fetch('/api/cek-antrean');
        const q = await res.json();

        if (lastRemoteQueueId === null) {
            lastRemoteQueueId = q.id;
            lastStopSignal = q.stop_signal;
            return;
        }

        if (q.stop_signal > lastStopSignal) {
            lastStopSignal = q.stop_signal;
            hentikanAudioLokal();
        }

        if (q.id > lastRemoteQueueId) {
            lastRemoteQueueId = q.id;
            if (isTerminalAudio && q.file_audio) {
                putarAudioLokal(q.file_audio, q.keterangan);
            }
        }
    } catch (e) { }
}, 2000);

// 6. Sinkronisasi Data Database SQLite & Daftar Audio
async function muatData() {
    try {
        const [resJ, resA, resL] = await Promise.all([
            fetch('/api/jadwal'),
            fetch('/api/audio-list'),
            fetch('/api/mode-libur')
        ]);

        daftarJadwal = await resJ.json();
        const audios = await resA.json();
        const liburData = await resL.json();
        isModeLibur = liburData.libur;

        const btnLibur = document.getElementById('btnLibur');
        if (btnLibur) {
            btnLibur.innerText = isModeLibur ? "⛔ Mode Libur: AKTIF (Klik untuk Normal)" : "📅 Mode Libur: NONAKTIF (Jadwal Jalan)";
            btnLibur.className = isModeLibur ? "btn btn-danger admin-only" : "btn btn-primary admin-only";
        }

        const quickGrid = document.getElementById('quickBellGrid');
        if (quickGrid) {
            quickGrid.innerHTML = audios.length === 0
                ? '<small style="color:#94a3b8;">Belum ada file audio MP3 di server.</small>'
                : audios.map(a => {
                    const labelRapi = a.replace(/\.[^/.]+$/, "").replace(/_/g, " ");
                    return `
              <button type="button" class="btn btn-teal" style="text-align:left; font-size:0.88rem; padding:10px 12px;"
                onclick="bunyikanBel('${a}', '${labelRapi}')">
                🔔 ${labelRapi}
              </button>
            `;
                }).join('');
        }

        const wita = getWaktuWITA();
        const filterSelect = document.getElementById('filterHari');
        let filterHari = filterSelect.value;

        if (filterHari === 'HARI_INI') {
            filterHari = wita.hari;
        }

        const filtered = filterHari === 'SEMUA' ? daftarJadwal : daftarJadwal.filter(j => j.hari === filterHari);

        const tbody = document.getElementById('tabelJadwal');
        if (filtered.length === 0) {
            tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; color:#94a3b8; padding:16px;">Tidak ada jadwal bel untuk filter (${filterHari}).</td></tr>`;
        } else {
            tbody.innerHTML = filtered.map(j => `
        <tr>
          <td><b>${j.hari}</b><br><span style="color:#38bdf8;font-size:1.05rem;">${j.jam}</span></td>
          <td>${j.keterangan}<br><small style="color:#94a3b8">${j.file_audio}</small></td>
          <td><span class="badge ${j.aktif ? 'on' : 'off'}">${j.aktif ? 'Aktif' : 'Off'}</span></td>
          <td>
            <button class="btn btn-sm btn-warn" onclick="bunyikanBel('${j.file_audio}', '${j.keterangan}')">▶ Putar</button>
            <button class="btn btn-sm btn-primary admin-only" onclick="toggleJadwal(${j.id})">On/Off</button>
            <button class="btn btn-sm btn-danger admin-only" onclick="hapusJadwal(${j.id})">Hapus</button>
          </td>
        </tr>
      `).join('');
        }

        const select = document.getElementById('selectAudio');
        if (select) {
            const prevVal = select.value;
            select.innerHTML = '<option value="">-- Pilih Audio Tersimpan --</option>' +
                audios.map(a => `<option value="${a}">${a}</option>`).join('');
            if (prevVal) select.value = prevVal;
        }

        const boxAudio = document.getElementById('daftarAudioTersimpan');
        if (boxAudio) {
            boxAudio.innerHTML = audios.length === 0
                ? '<small style="color:#94a3b8;">Belum ada file audio di server.</small>'
                : audios.map(a => `
          <span style="background:#0f172a; border:1px solid #334155; padding:5px 9px; border-radius:6px; font-size:0.82rem; display:inline-flex; align-items:center; gap:6px;">
            <code>${a}</code>
            <button type="button" class="btn btn-sm btn-warn" style="padding:2px 6px;" onclick="bunyikanBel('${a}', 'Tes: ${a}')" title="Bunyikan">🔔</button>
            <button type="button" class="btn btn-sm btn-danger" style="padding:2px 6px;" onclick="hapusFileAudio('${a}')" title="Hapus File">×</button>
          </span>
        `).join('');
        }
    } catch (e) { }
}

// Handler Multi-Upload Audio
const formMultiAudio = document.getElementById('formMultiAudio');
if (formMultiAudio) {
    formMultiAudio.addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = e.target.querySelector('button[type="submit"]');
        const teksAsli = btn.innerText;
        btn.disabled = true;
        btn.innerText = "⏳ Mengunggah file audio...";

        try {
            const formData = new FormData(e.target);
            const res = await fetch('/api/upload-audio-massal', { method: 'POST', body: formData });
            const hasil = await res.json();
            if (res.ok) {
                alert(`Berhasil mengunggah ${hasil.jumlah} file audio:\n- ${hasil.berhasil.join('\n- ')}`);
                e.target.reset();
                muatData();
            } else {
                alert(hasil.message || "Gagal mengunggah file audio.");
            }
        } finally {
            btn.disabled = false;
            btn.innerText = teksAsli;
        }
    });
}

async function hapusFileAudio(filename) {
    if (confirm(`Hapus file audio "${filename}" dari server?`)) {
        await fetch(`/api/audio/${encodeURIComponent(filename)}`, { method: 'DELETE' });
        muatData();
    }
}

// Handler Import Excel
const formExcel = document.getElementById('formExcel');
if (formExcel) {
    formExcel.addEventListener('submit', async (e) => {
        e.preventDefault();
        const formData = new FormData(e.target);
        const res = await fetch('/api/import-excel', { method: 'POST', body: formData });
        const hasil = await res.json();
        if (res.ok) {
            let pesan = `Berhasil mengimpor ${hasil.jumlah} jadwal bel dari Excel!`;
            if (hasil.audio_hilang && hasil.audio_hilang.length > 0) {
                pesan += `\n\n⚠️ PERHATIAN: File audio berikut tertulis di Excel tetapi belum diunggah ke server:\n- ${hasil.audio_hilang.join('\n- ')}`;
            }
            alert(pesan);
            e.target.reset();
            muatData();
        } else {
            alert(hasil.message || "Gagal mengimpor file Excel.");
        }
    });
}

// Handler Tambah Jadwal Satuan
const formJadwal = document.getElementById('formJadwal');
if (formJadwal) {
    formJadwal.addEventListener('submit', async (e) => {
        e.preventDefault();
        const formData = new FormData(e.target);
        const res = await fetch('/api/jadwal', { method: 'POST', body: formData });
        if (res.ok) {
            e.target.reset();
            muatData();
        } else {
            alert("Gagal menyimpan. Pastikan hari, jam, keterangan, dan audio terisi.");
        }
    });
}

async function toggleJadwal(id) {
    await fetch(`/api/jadwal/${id}/toggle`, { method: 'POST' });
    muatData();
}

async function hapusJadwal(id) {
    if (confirm('Hapus jadwal bel ini?')) {
        await fetch(`/api/jadwal/${id}`, { method: 'DELETE' });
        muatData();
    }
}

async function toggleLibur() {
    await fetch('/api/mode-libur', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ libur: !isModeLibur })
    });
    muatData();
}

async function salinJadwalHari() {
    const dari_hari = document.getElementById('salinDari').value;
    const ke_hari = document.getElementById('salinKe').value;
    const res = await fetch('/api/salin-jadwal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dari_hari, ke_hari })
    });
    const data = await res.json();
    if (res.ok) {
        alert(`Berhasil menyalin ${data.jumlah} jadwal dari ${dari_hari} ke ${ke_hari}.`);
        muatData();
    } else {
        alert(data.message || "Gagal menyalin jadwal.");
    }
}

// Inisialisasi awal
if (!isSpeakerViewOnly) {
    document.getElementById('filterHari').value = 'SEMUA';
}
sinkronWaktuServer();
muatData();
setInterval(muatData, 15000);
setInterval(sinkronWaktuServer, 300000);