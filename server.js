import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { google } from 'googleapis';
import multer from 'multer'; // Pustaka baru untuk membaca file kiriman React
import { Readable } from 'stream';

dotenv.config();

const app = express();
const PORT = 3000;

app.use(cors({ origin: 'http://localhost:5173' }));
app.use(express.json());

// Konfigurasi Multer untuk menyimpan file sementara di memori buffer
const upload = multer({ storage: multer.memoryStorage() });

const oauth2Client = new google.auth.OAuth2(
  process.env.CLIENT_ID,
  process.env.CLIENT_SECRET,
  process.env.REDIRECT_URI
);

// --- TARUH DI SINI ---
app.use(cors({ origin: 'http://localhost:5173' }));
app.use(express.json({ limit: '50mb' })); // Batas JSON diperbesar
app.use(express.urlencoded({ limit: '50mb', extended: true })); // Batas URL-encoded diperbesar
// ---------------------

// JALUR 1: Menukarkan kode saat pertama kali login
app.post('/tukar-token', async (req, res) => {
  try {
    const { code } = req.body;
    const { tokens } = await oauth2Client.getToken(code);
    res.json(tokens);
  } catch (error) {
    console.error('Gagal menukar token:', error.message);
    res.status(500).json({ error: 'Gagal menukar token' });
  }
});

// JALUR 2: Memperbarui Access Token menggunakan Refresh Token
app.post('/refresh-token', async (req, res) => {
  try {
    const { refresh_token } = req.body;
    oauth2Client.setCredentials({ refresh_token: refresh_token });
    const responskunci = await oauth2Client.getAccessToken();
    res.json({ access_token: responskunci.token });
  } catch (error) {
    console.error('Gagal memperbarui token:', error.message);
    res.status(500).json({ error: 'Gagal memperbarui token' });
  }
});

// JALUR 3: Menerima file dari React dan mengunggahnya ke Google Drive
app.post('/upload', upload.single('file'), async (req, res) => {
  try {
    const { access_token, parent_id } = req.body; // Tambahkan parent_id di sini
    const file = req.file;

    if (!file) return res.status(400).json({ error: 'Tidak ada file yang dipilih' });

    const auth = new google.auth.OAuth2();
    auth.setCredentials({ access_token });
    const drive = google.drive({ version: 'v3', auth });

    // Modifikasi bagian ini agar file masuk ke folder yang tepat
    const fileMetadata = { 
      name: file.originalname,
      parents: parent_id && parent_id !== 'root' ? [parent_id] : [] 
    };

    const media = {
      mimeType: file.mimetype,
      body: Readable.from(file.buffer) 
    };

    const responsGoogle = await drive.files.create({
      requestBody: fileMetadata,
      media: media,
      fields: 'id, name'
    });

    console.log(`Sukses mengunggah file: ${responsGoogle.data.name}`);
    res.json({ success: true, file: responsGoogle.data });
  } catch (error) {
    console.error('Gagal upload ke Google:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// JALUR 4: Membuat Folder (Mendukung pembuatan folder di dalam folder lain)
app.post('/create-folder', async (req, res) => {
  try {
    const { folder_name, parent_id, access_token } = req.body;
    const auth = new google.auth.OAuth2();
    auth.setCredentials({ access_token });
    const drive = google.drive({ version: 'v3', auth });

    const fileMetadata = {
      name: folder_name,
      mimeType: 'application/vnd.google-apps.folder',
      parents: parent_id ? [parent_id] : [] // Jika ada parent_id, buat folder di dalamnya
    };

    const responsGoogle = await drive.files.create({
      requestBody: fileMetadata,
      fields: 'id, name'
    });

    res.json({ success: true, folder: responsGoogle.data });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// JALUR 4 (BARU): Menerima ID File dan menghapusnya dari Google Drive asli
app.post('/delete-file', async (req, res) => {
  try {
    const { file_id, access_token } = req.body;

    const auth = new google.auth.OAuth2();
    auth.setCredentials({ access_token });
    const drive = google.drive({ version: 'v3', auth });

    await drive.files.delete({ fileId: file_id });
    
    console.log(`Sukses menghapus file dengan ID: ${file_id}`);
    res.json({ success: true, message: 'File berhasil dihapus' });
  } catch (error) {
    console.error('Gagal menghapus file dari Google:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// JALUR 5: RENAME (Mengubah Nama File/Folder)
app.post('/rename-file', async (req, res) => {
  try {
    const { file_id, new_name, access_token } = req.body;
    const auth = new google.auth.OAuth2();
    auth.setCredentials({ access_token });
    const drive = google.drive({ version: 'v3', auth });

    const respons = await drive.files.update({
      fileId: file_id,
      requestBody: { name: new_name },
      fields: 'id, name'
    });
    res.json({ success: true, file: respons.data });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// JALUR 6: COPY (Menggandakan File)
app.post('/copy-file', async (req, res) => {
  try {
    const { file_id, access_token } = req.body;
    const auth = new google.auth.OAuth2();
    auth.setCredentials({ access_token });
    const drive = google.drive({ version: 'v3', auth });

    // API Copy dari Google
    const respons = await drive.files.copy({
      fileId: file_id,
      fields: 'id, name'
    });
    res.json({ success: true, file: respons.data });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// JALUR 7: SHARE (Membuat Link Publik)
app.post('/share-file', async (req, res) => {
  try {
    const { file_id, access_token } = req.body;
    const auth = new google.auth.OAuth2();
    auth.setCredentials({ access_token });
    const drive = google.drive({ version: 'v3', auth });

    // Mengubah hak akses menjadi "Siapa saja yang memiliki link dapat melihat"
    await drive.permissions.create({
      fileId: file_id,
      requestBody: { role: 'reader', type: 'anyone' }
    });

    // Ambil link terbaru
    const respons = await drive.files.get({
      fileId: file_id,
      fields: 'webViewLink'
    });
    
    res.json({ success: true, link: respons.data.webViewLink });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server Backend Tarodrive Siap di http://localhost:${PORT}`);
});