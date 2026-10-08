# AgentDesk 🤖

Satu aplikasi desktop untuk banyak agen AI — tiap agen punya nama, ikon, peran (system prompt),
dan model sendiri, seperti di screenshot yang kamu kirim.

## Cara menjalankan

1. Install **Node.js LTS** (https://nodejs.org)
2. Buka terminal di folder ini:
   ```
   npm install
   npm start
   ```

## Pengaturan backend (muncul saat pertama dibuka)

Aplikasi ini memakai API yang **OpenAI-compatible** — satu kunci untuk semua agen.

| Preset | Base URL | API Key | Model |
|---|---|---|---|
| OpenAI | `https://api.openai.com/v1` | `sk-...` | `gpt-4o-mini` |
| Ollama (lokal, gratis) | `http://localhost:11434/v1` | `ollama` | `llama3.1` |
| Kustom / 9Router | `https://kabe9router.pages.dev/v1` | API key 9Router kamu | `muse-spark` |

Untuk Ollama, jalankan dulu `ollama serve` dan `ollama pull llama3.1` di terminal.
Tombol **Tes koneksi** memastikan setting benar sebelum mulai.

**Mode streaming** (⚙ Pengaturan): *Otomatis* mendeteksi apakah backend mendukung SSE;
kalau tidak (mis. `muse-spark` via muse-bridge — jawabannya datang utuh setelah ~14 detik),
aplikasi otomatis memakai mode non-streaming. Bisa juga dipaksa lewat pilihan
*Selalu streaming* / *Tanpa streaming*.

## Fitur

- **Sidebar banyak agen** — bawaan: Chief, Sales Outbound, Inbox Manager, Account Manager,
  Talent Scout, Expense Manager, Computer, dan **Muse** ✨ (AI-nya dari aku, via 9Router).
- **Tiap agen bisa diatur** — nama, ikon emoji, warna, system prompt, model, dan temperature
  (tombol ✏️ Edit di header chat, atau ＋ Agen baru di sidebar).
- **Backend per agen** — tiap agen bisa menunjuk AI yang berbeda: isi base URL + API key +
  model di pengaturan agen, atau kosongkan untuk memakai pengaturan global. Contoh: agen
  Sales pakai OpenAI, agen Muse pakai `https://kabe9router.pages.dev/v1` + model `muse-spark`.
  Untuk agen Muse, tinggal isi API key 9Router kamu di kolom API key agen itu.
- **👥 Grup Chat** — baris paling atas di sidebar. Tulis satu pesan, semua agen peserta
  menjawab bergiliran sesuai urutan sidebar, masing-masing melihat seluruh percakapan dan
  merespons strictly sesuai jobdesk-nya (tidak mengulang yang sudah dibahas agen lain).
  Klik ⚙ Kelola di header grup untuk memilih siapa saja yang ikut.
- **Riwayat chat per agen** tersimpan otomatis di komputer (tidak ada cloud).
- **Agen "Computer" bisa menjalankan perintah shell** — setiap perintah memunculkan kartu
  *⚡ Action needed* dan hanya jalan kalau kamu klik **Jalankan**.
- Cari agen lewat kolom search di sidebar.

## Catatan

- API key tersimpan sebagai file lokal di komputer ini saja
  (folder userData Electron) — tidak dikirim ke mana pun selain base URL yang kamu isi.
- v1 belum ada: sinkronisasi antar perangkat, login multi-user, dan approval bertingkat.

## Packaging jadi file installer (opsional)

```
npx @electron/packager . AgentDesk --platform=win32 --arch=x64
```
Ganti `--platform` dengan `darwin` untuk macOS atau `linux` untuk Linux.
