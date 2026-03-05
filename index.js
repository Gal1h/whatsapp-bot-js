const fs = require('fs');
const express = require('express');
const axios = require('axios');
const qrcode = require('qrcode-terminal');
const { Client, LocalAuth } = require('whatsapp-web.js');

const userPrefix = '@180732777492705';
const blacklistMessage = ['maen', 'main', 'epep', 'mcgg'];
const path = require('path');
const filePath = path.join(__dirname, 'memory.json');

// Setiap N chat, baru minta Ollama buat ringkasan (hemat resource VPS)
const SUMMARIZE_EVERY = 5;

const app = express();

const client = new Client({
    authStrategy: new LocalAuth({ clientId: 'Sylvia' }),
    puppeteer: {
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    }
});

client.on('qr', qr => qrcode.generate(qr, { small: true }));
client.on('ready', () => console.log('Sylvia is ready!'));

client.on('message_create', async (msg) => {
    const body = msg.body || "";
    const contact = await msg.getContact();
    const chat = await msg.getChat();
    let userName;
    if (chat.isGroup) {
        const nama = contact.pushname || contact.name || 'Unknown';
        userName = nama
    } else {
        const nama = contact.name || contact.pushname || 'Unknown';
        userName = nama
    }

    // Stiker: download media dengan retry + timeout
    if (msg.hasMedia && msg.type === 'image' && body.toLowerCase().startsWith('.s')) {
        try {
            let media = null;
            for (let attempt = 1; attempt <= 3; attempt++) {
                try {
                    media = await Promise.race([
                        msg.downloadMedia(),
                        new Promise((_, reject) =>
                            setTimeout(() => reject(new Error('Download timeout')), 15000)
                        )
                    ]);
                    if (media) break;
                } catch (dlErr) {
                    console.error(`Attempt ${attempt} gagal download media:`, dlErr.message);
                    if (attempt < 3) await new Promise(r => setTimeout(r, 2000));
                }
            }
            if (!media) {
                await msg.reply('Gagal download gambar, coba kirim ulang.');
                return;
            }
            await client.sendMessage(msg.from, media, {
                sendMediaAsSticker: true,
                stickerName: "Sylvia Sticker",
                stickerAuthor: "Sylvia AI"
            });
            return;
        } catch (err) {
            console.error("Gagal convert stiker:", err.message);
            await msg.reply('Gagal bikin stiker, coba lagi.');
        }
    }

    if (body.includes('@all') && !blacklistMessage.some(kata => body.toLowerCase().includes(kata))) {
        return msg.reply('Penyakit tag all gila');
    }

    const userId = msg.from;

    let prompt = "";
    if (body.startsWith(userPrefix)) {
        prompt = body.substring(userPrefix.length).trim();
    } else if (body.toLowerCase().startsWith('hai sylvia')) {
        prompt = body;
    }

    if (prompt) {
        const response = await getBotResponse(prompt, userId, userName);
        msg.reply(response);
    }
});


// Deteksi nama dari teks chat secara sederhana
function extractNameFromText(text) {
    const patterns = [
        /nama(?:ku|saya|ku adalah|saya adalah| adalah| aku| gue| gw)[\s:]+([A-Za-z]+)/i,
        /(?:panggil|sebut|call)(?:\s+aku|\s+saya|\s+gue|\s+gw)?[\s:]+([A-Za-z]+)/i,
        /aku(?:\s+adalah)?[\s:]+([A-Za-z]+)/i,
        /saya(?:\s+adalah)?[\s:]+([A-Za-z]+)/i,
        /(?:perkenalkan|perkenalkan,?\s+)?aku\s+([A-Za-z]+)/i,
    ];
    for (const pattern of patterns) {
        const match = text.match(pattern);
        if (match && match[1] && match[1].length > 1) {
            // Hindari false positive kata umum
            const skip = ['adalah', 'dari', 'yang', 'dan', 'ini', 'itu', 'mau', 'bisa', 'user', 'bot'];
            if (!skip.includes(match[1].toLowerCase())) {
                return match[1];
            }
        }
    }
    return null;
}


const getBotResponse = async (userPrompt, userId, userName) => {
    try {


        let allMemory = {};
        if (fs.existsSync(filePath)) {
            const content = fs.readFileSync(filePath, 'utf8').trim();
            if (content) {
                try { allMemory = JSON.parse(content); }
                catch (e) { console.error('Memory file corrupt, reset:', e.message); }
            }
        }

        const userMemory = allMemory[userId] || {
            nama: userName,
            ringkasan: "Belum ada informasi khusus.",
            fakta: [],
            chatLog: [],
            totalChat: 0
        };

        // Ollama ~14 detik untuk prompt pendek, set 120 detik agar aman
        const response = await axios.post('http://localhost:11434/api/chat', {
            model: 'Sylvia',
            stream: false,
            messages: [
                {
                    role: 'system',
                    content: `Kamu Sylvia. Kamu bicara dengan ID: ${userId}. Ingatanmu tentang dia — Nama: ${userMemory.nama}. Ringkasan: ${userMemory.ringkasan}. Fakta: ${JSON.stringify(userMemory.fakta)}`
                },
                { role: 'user', content: userPrompt }
            ],
        }, { timeout: 120000 });

        if (!response.data || !response.data.message || !response.data.message.content) {
            console.error('Response Ollama tidak valid:', JSON.stringify(response.data));
            return "Aduh, jawaban Ollama kosong nih...";
        }

        const aiReply = response.data.message.content;

        // Simpan memory — async, tidak blocking chat
        updateUserMemory(userId, userMemory, userPrompt, aiReply).catch(e =>
            console.error('updateUserMemory error:', e.message)
        );

        return aiReply;
    } catch (error) {
        console.error('Error connecting to Ollama:', error.message);
        return "Aduh, memoriku agak konslet...";
    }
};


async function updateUserMemory(userId, oldUserMemory, prompt, reply, userName) {
    try {
        let allMemory = {};
        if (fs.existsSync(filePath)) {
            const content = fs.readFileSync(filePath, 'utf8').trim();
            if (content) {
                try { allMemory = JSON.parse(content); }
                catch (e) { console.error('Memory corrupt, reset:', e.message); }
            }
        }

        const mem = allMemory[userId] || {
            nama: userName || "User",
            ringkasan: "Belum ada informasi khusus.",
            fakta: [],
            chatLog: [],
            totalChat: 0
        };

        if (!Array.isArray(mem.chatLog)) mem.chatLog = [];
        if (!Array.isArray(mem.fakta)) mem.fakta = [];

        mem.chatLog.push({ user: prompt, sylvia: reply, ts: Date.now() });
        mem.totalChat = (mem.totalChat || 0) + 1;

        // Batasi log maksimal 50 entry
        if (mem.chatLog.length > 50) mem.chatLog = mem.chatLog.slice(-50);

        const detectedName = extractNameFromText(prompt);
        if (detectedName) {
            mem.nama = detectedName; // User eksplisit bilang namanya
        } else if (mem.nama === 'User' && userName) {
            mem.nama = userName; // Pakai nama WhatsApp jika belum ada
        }

        // Tulis ke file — ini selalu berhasil, tidak ada Ollama
        allMemory[userId] = mem;
        fs.writeFileSync(filePath, JSON.stringify(allMemory, null, 2));
        console.log(`Chat log user ${userId} disimpan. Total chat: ${mem.totalChat}, Nama: ${mem.nama}`);

        // Setiap SUMMARIZE_EVERY chat, update ringkasan via Ollama (background)
        if (mem.totalChat % SUMMARIZE_EVERY === 0) {
            console.log(`Trigger summarize memori user ${userId} (chat ke-${mem.totalChat})...`);
            summarizeMemory(userId, mem).catch(e =>
                console.error('summarizeMemory non-fatal error:', e.message)
            );
        }
    } catch (e) {
        console.error('updateUserMemory gagal:', e.message);
    }
}


// Dipanggil setiap N chat — kalau timeout tidak apa-apa, chatLog tetap tersimpan
async function summarizeMemory(userId, mem) {
    const recentLog = mem.chatLog.slice(-SUMMARIZE_EVERY)
        .map(c => `User: ${c.user}\nSylvia: ${c.sylvia}`)
        .join('\n---\n');

    const mergePrompt = `Kamu adalah sistem memori AI. Tugasmu memperbarui ingatan user secara AKUMULATIF.

INGATAN LAMA:
Nama: ${mem.nama}
Ringkasan: ${mem.ringkasan}
Fakta: ${JSON.stringify(mem.fakta)}

CHAT TERBARU:
${recentLog}

INSTRUKSI:
- Pertahankan semua informasi lama yang masih relevan
- Tambahkan informasi baru (nama, hobi, preferensi, fakta penting)
- Jangan hapus fakta lama kecuali user mengoreksinya
- "fakta" adalah array string singkat, maksimal 10 item
- Jika nama sudah diketahui, pertahankan nama tersebut

Balas HANYA JSON murni tanpa markdown tanpa penjelasan:
{"nama": "...", "ringkasan": "...", "fakta": ["...", "..."]}`;

    const update = await axios.post('http://localhost:11434/api/generate', {
        model: 'Sylvia',
        prompt: mergePrompt,
        format: "json",
        stream: false
    }, { timeout: 180000 });

    if (!update.data || !update.data.response || !update.data.response.trim()) {
        console.error('Summarize: response Ollama kosong, skip.');
        return;
    }

    let rawJson = update.data.response.trim().replace(/```json|```/g, '').trim();

    let summary;
    try {
        summary = JSON.parse(rawJson);
    } catch (e) {
        console.error('Summarize: gagal parse JSON:', e.message, '| Raw:', rawJson.substring(0, 200));
        return;
    }

    // Baca ulang file, merge ringkasan baru — pertahankan chatLog & totalChat
    let allMemory = {};
    if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, 'utf8').trim();
        if (content) {
            try { allMemory = JSON.parse(content); }
            catch (e) { allMemory = {}; }
        }
    }

    const existing = allMemory[userId] || mem;

    // Jangan timpa nama yang sudah benar dengan "User"
    const finalNama = (summary.nama && summary.nama !== 'User')
        ? summary.nama
        : existing.nama;

    allMemory[userId] = {
        ...existing,
        nama: finalNama,
        ringkasan: summary.ringkasan || existing.ringkasan,
        fakta: Array.isArray(summary.fakta) ? summary.fakta : existing.fakta,
    };

    fs.writeFileSync(filePath, JSON.stringify(allMemory, null, 2));
    console.log(`Ringkasan memori user ${userId} diperbarui Ollama. Nama: ${finalNama}`);
}


client.initialize();
app.listen(8000, () => console.log('Server running on port 8000'));