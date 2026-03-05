const fs = require('fs');
const express = require('express');
const axios = require('axios');
const qrcode = require('qrcode-terminal');
const { Client, LocalAuth } = require('whatsapp-web.js');

const userPrefix = '@180732777492705';
const blacklistMessage = ['maen', 'main', 'epep', 'mcgg'];
const path = require('path');
const filePath = path.join(__dirname, 'memory.json');

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

    // FIX 1: downloadMedia — tambah retry + timeout handling
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

    // FIX 2: userId seharusnya diambil dari msg.from, bukan undefined
    const userId = msg.from;

    let prompt = "";
    if (body.startsWith(userPrefix)) {
        prompt = body.substring(userPrefix.length).trim();
    } else if (body.toLowerCase().startsWith('hai sylvia')) {
        prompt = body;
    }

    if (prompt) {
        // FIX 3: pass userId yang benar ke getBotResponse
        const response = await getBotResponse(prompt, userId);
        msg.reply(response);
    }
});


const getBotResponse = async (userPrompt, userId) => {
    try {
        // Baca Database Memori
        let allMemory = {};
        if (fs.existsSync(filePath)) {
            const content = fs.readFileSync(filePath, 'utf8').trim();
            if (content) {
                try {
                    allMemory = JSON.parse(content);
                } catch (e) {
                    console.error('Memory file corrupt, reset:', e.message);
                    allMemory = {};
                }
            }
        }

        const userMemory = allMemory[userId] || {
            nama: "User",
            ringkasan: "Belum ada informasi khusus.",
            fakta: [],
            totalChat: 0
        };

        // FIX 4: tambah timeout untuk request Ollama
        const response = await axios.post('http://localhost:11434/api/chat', {
            model: 'Sylvia',
            stream: false,
            messages: [
                {
                    role: 'system',
                    content: `Kamu Sylvia. Kamu bicara dengan ID: ${userId}. Ingatanmu tentang dia: ${JSON.stringify(userMemory)}`
                },
                { role: 'user', content: userPrompt }
            ],
        }, {
            timeout: 60000 // 60 detik timeout
        });

        // FIX 5: validasi response sebelum akses .content
        if (!response.data || !response.data.message || !response.data.message.content) {
            console.error('Response Ollama tidak valid:', JSON.stringify(response.data));
            return "Aduh, jawaban Ollama kosong nih...";
        }

        const aiReply = response.data.message.content;

        // Update memori secara async (tidak blocking)
        updateUserMemory(userId, userMemory, userPrompt, aiReply).catch(e =>
            console.error('updateUserMemory error:', e.message)
        );

        return aiReply;
    } catch (error) {
        console.error('Error connecting to Ollama:', error.message);
        return "Aduh, memoriku agak konslet...";
    }
};


async function updateUserMemory(userId, oldUserMemory, prompt, reply) {
    try {
        // Susun prompt agar model MERGE (akumulasi) bukan replace
        const mergePrompt = `
Kamu adalah sistem memori AI. Tugasmu adalah memperbarui ingatan tentang seorang user secara AKUMULATIF.

INGATAN LAMA:
${JSON.stringify(oldUserMemory, null, 2)}

CHAT BARU:
User: "${prompt}"
Sylvia: "${reply}"

INSTRUKSI:
- Pertahankan semua informasi lama yang masih relevan
- Tambahkan informasi baru dari chat di atas (nama, hobi, fakta, preferensi, dll)
- Perbarui ringkasan agar mencakup semua yang sudah diketahui
- Jangan hapus fakta lama kecuali user secara eksplisit mengoreksinya
- Field "fakta" adalah array string berisi fakta-fakta penting tentang user
- Field "totalChat" tambahkan 1 dari nilai lama

Balas HANYA dengan JSON murni, tanpa markdown, tanpa penjelasan:
{"nama": "...", "ringkasan": "...", "fakta": ["...", "..."], "totalChat": 0}
`;

        const update = await axios.post('http://localhost:11434/api/generate', {
            model: 'Sylvia',
            prompt: mergePrompt,
            format: "json",
            stream: false
        }, {
            timeout: 60000
        });

        // Validasi response tidak kosong
        if (!update.data || !update.data.response || !update.data.response.trim()) {
            console.error('Response update memori kosong untuk userId:', userId);
            return;
        }

        // Bersihkan markdown fence jika ada
        let rawJson = update.data.response.trim();
        rawJson = rawJson.replace(/```json|```/g, '').trim();

        let newMemory;
        try {
            newMemory = JSON.parse(rawJson);
        } catch (parseErr) {
            console.error('Gagal parse update memori:', parseErr.message, '| Raw:', rawJson.substring(0, 300));
            return;
        }

        // Pastikan field totalChat selalu bertambah, bukan diganti sembarangan
        const oldTotal = oldUserMemory.totalChat || 0;
        if (!newMemory.totalChat || newMemory.totalChat <= oldTotal) {
            newMemory.totalChat = oldTotal + 1;
        }

        // Pastikan field fakta adalah array
        if (!Array.isArray(newMemory.fakta)) {
            newMemory.fakta = oldUserMemory.fakta || [];
        }

        // Baca ulang file (hindari race condition), lalu tulis
        let allMemory = {};
        if (fs.existsSync(filePath)) {
            const content = fs.readFileSync(filePath, 'utf8').trim();
            if (content) {
                try {
                    allMemory = JSON.parse(content);
                } catch (e) {
                    console.error('Memory file corrupt saat update, reset:', e.message);
                }
            }
        }

        allMemory[userId] = newMemory;
        fs.writeFileSync(filePath, JSON.stringify(allMemory, null, 2));
        console.log(`Memori user ${userId} diupdate. Total chat: ${newMemory.totalChat}`);
    } catch (e) {
        console.error('updateUserMemory gagal:', e.message);
    }
}

client.initialize();
app.listen(8000, () => console.log('Server running on port 8000'));